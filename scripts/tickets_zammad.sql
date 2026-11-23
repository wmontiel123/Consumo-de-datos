-- Tickets de Zammad (soporte.inovasi.com.py) abiertos por la Edge Function solicitud-usuario.
-- tipo: acceso | reseteo | linea   ·   clave: usuario (acceso / reseteo) o id de la solicitud (linea)
-- Solo la usa la función (service_role): RLS activo y sin políticas.
-- Ejecutar en el SQL Editor de Supabase.
create table if not exists tickets_zammad (
    id         bigint generated always as identity primary key,
    tipo       text not null,
    clave      text not null,
    ticket_id  bigint not null,
    numero     text,
    creado_en  timestamptz not null default now(),
    cerrado_en timestamptz
);
create index if not exists tickets_zammad_abiertos on tickets_zammad (tipo, clave) where cerrado_en is null;
alter table tickets_zammad enable row level security;
notify pgrst, 'reload schema';
