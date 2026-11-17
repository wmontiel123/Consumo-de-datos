-- ════════════════════════════════════════════════════════════════
-- Inventario de líneas LEGADO (tabla aparte de "lineas")
--   Números / ICCID de los RC de tipo Legado. Misma forma que "lineas"
--   para que la app los muestre y los active / desactive igual.
--
-- Ejecutar todo junto en el SQL Editor de Supabase.
-- ════════════════════════════════════════════════════════════════

create table if not exists lineas_legado (
    id           bigint generated always as identity primary key,
    numero       text,
    iccid        text,
    telefonia    text,
    estado       text not null default 'asignada'
                 check (estado in ('disponible', 'asignada', 'desactivada')),
    rc_codigo    text,
    sim_slot     text check (sim_slot in ('sim1', 'sim2')),
    observacion  text,
    creado_por   text,
    creado_en    timestamptz not null default now(),
    check (numero is not null or iccid is not null)
);

create unique index if not exists lineas_legado_numero_uq on lineas_legado (numero)
    where numero is not null and lower(numero) <> 'm2m';
create unique index if not exists lineas_legado_iccid_uq  on lineas_legado (iccid) where iccid is not null;
create index if not exists lineas_legado_rc_idx on lineas_legado (rc_codigo);

-- Mismos permisos por rol que "lineas": viewer y admin leen, solo admin escribe
alter table lineas_legado enable row level security;
revoke all on lineas_legado from anon;
grant select, insert, update, delete on lineas_legado to authenticated;
grant all on lineas_legado to service_role;

drop policy if exists rol_leer on lineas_legado;
create policy rol_leer on lineas_legado for select to authenticated
    using ((select app_rol()) in ('viewer', 'admin'));
drop policy if exists rol_admin_escribe on lineas_legado;
create policy rol_admin_escribe on lineas_legado for all to authenticated
    using ((select app_rol()) = 'admin') with check ((select app_rol()) = 'admin');

notify pgrst, 'reload schema';
