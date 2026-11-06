-- ════════════════════════════════════════════════════════════════
-- Módulos "Altas" y "Activaciones"
--   - lineas:            inventario de líneas (número / ICCID) y a qué RC están asignadas
--   - historial_estados: altas, activaciones y desactivaciones de RC y líneas,
--                        con el usuario que las hizo
--
-- Ejecutar todo junto en el SQL Editor de Supabase.
-- ════════════════════════════════════════════════════════════════

create table if not exists lineas (
    id           bigint generated always as identity primary key,
    numero       text,
    iccid        text,
    telefonia    text,
    estado       text not null default 'disponible'
                 check (estado in ('disponible', 'asignada', 'desactivada')),
    rc_codigo    text,
    sim_slot     text check (sim_slot in ('sim1', 'sim2')),
    observacion  text,
    creado_por   text,
    creado_en    timestamptz not null default now(),
    check (numero is not null or iccid is not null)
);

-- Un mismo número o ICCID no puede cargarse dos veces ('M2M' no es un número real)
create unique index if not exists lineas_numero_uq on lineas (numero)
    where numero is not null and lower(numero) <> 'm2m';
create unique index if not exists lineas_iccid_uq  on lineas (iccid) where iccid is not null;
create index if not exists lineas_rc_idx on lineas (rc_codigo);


create table if not exists historial_estados (
    id               bigint generated always as identity primary key,
    tipo             text not null check (tipo in ('rc', 'linea')),
    referencia       text not null,          -- código del RC, o número/ICCID de la línea
    estado_anterior  text,
    estado_nuevo     text not null,          -- 'alta' | 'activo' | 'desactivado' | 'asignada' | ...
    motivo           text,
    usuario          text,
    fecha            timestamptz not null default now()
);

create index if not exists historial_estados_fecha_idx on historial_estados (fecha desc);
create index if not exists historial_estados_ref_idx   on historial_estados (tipo, referencia);


-- Permisos para la app (usa la clave pública "anon", igual que el resto de las tablas)
alter table lineas            enable row level security;
alter table historial_estados enable row level security;

drop policy if exists "app lee lineas"       on lineas;
drop policy if exists "app inserta lineas"   on lineas;
drop policy if exists "app actualiza lineas" on lineas;
create policy "app lee lineas"       on lineas for select to anon, authenticated using (true);
create policy "app inserta lineas"   on lineas for insert to anon, authenticated with check (true);
create policy "app actualiza lineas" on lineas for update to anon, authenticated using (true) with check (true);

-- El historial solo se lee y se agrega: no se puede modificar ni borrar desde la app
drop policy if exists "app lee historial_estados"     on historial_estados;
drop policy if exists "app inserta historial_estados" on historial_estados;
create policy "app lee historial_estados"     on historial_estados for select to anon, authenticated using (true);
create policy "app inserta historial_estados" on historial_estados for insert to anon, authenticated with check (true);

grant select, insert, update on lineas            to anon, authenticated;
grant select, insert         on historial_estados to anon, authenticated;

notify pgrst, 'reload schema';
