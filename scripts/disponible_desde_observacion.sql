-- ══════════════════════════════════════════════════════════════════
-- Plan disponible que llega en la columna de observación
--
-- Solo los reportes de Personal traen la columna "observación"; en Claro,
-- Tigo y Vox la 6ª columna ya es el plan disponible, y el cargador la
-- guardaba como observación. Este trigger lo corrige al cargar (sin tocar
-- el instalador) y el UPDATE de abajo arregla lo que ya está cargado.
--
-- Regla: telefonía distinta de Personal + observación que es solo un número
-- (opcionalmente con "MB" o "GB") → va a plan_disponible_mb y la
-- observación queda vacía. Si la fila ya trae plan_disponible_mb, se respeta.
--
-- Correr una sola vez en el SQL Editor de Supabase (se puede repetir).
-- ══════════════════════════════════════════════════════════════════

-- Texto → MB. Acepta 1234 · 1234.5 · 1234,5 · 1.234,5 · "20 MB" · "1,5 GB". No numérico → null
create or replace function public._plan_desde_texto(p text)
returns numeric
language plpgsql immutable as $$
declare
    s text;
    v numeric;
begin
    if p is null or p !~* '^\s*-?\d[\d.,]*\s*(mb|gb)?\s*$' then
        return null;
    end if;
    s := regexp_replace(p, '[^0-9.,-]', '', 'g');
    if position(',' in s) > 0 then
        s := replace(replace(s, '.', ''), ',', '.');   -- coma decimal, punto de miles
    end if;
    begin
        v := s::numeric;
    exception when others then
        return null;
    end;
    if p ~* 'gb' then v := v * 1024; end if;
    return v;
end $$;

create or replace function public.trg_consumo_plan_desde_obs()
returns trigger
language plpgsql as $$
declare
    v numeric;
begin
    if coalesce(lower(trim(new.telefonia)), '') <> 'personal' and new.observacion is not null then
        v := public._plan_desde_texto(new.observacion);
        if v is not null then
            if new.plan_disponible_mb is null then
                new.plan_disponible_mb := v;
            end if;
            new.observacion := null;
        end if;
    end if;
    return new;
end $$;

drop trigger if exists consumo_plan_desde_obs on public.consumo_sim;
create trigger consumo_plan_desde_obs
    before insert or update of observacion, plan_disponible_mb on public.consumo_sim
    for each row execute function public.trg_consumo_plan_desde_obs();

-- Corregir lo ya cargado
update public.consumo_sim
   set plan_disponible_mb = coalesce(plan_disponible_mb, public._plan_desde_texto(observacion)),
       observacion        = null
 where coalesce(lower(trim(telefonia)), '') <> 'personal'
   and public._plan_desde_texto(observacion) is not null;

-- Pasar el disponible a las líneas del inventario y recalcular estados
select public.refresh_lineas_estado();
