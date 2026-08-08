create table if not exists public.dashboard_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  creado_en timestamptz not null default now()
);

alter table public.dashboard_admins enable row level security;
revoke all on table public.dashboard_admins from public, anon, authenticated;

create or replace function public.consultar_dashboard_admin()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_resultado jsonb;
  v_empresas integer := 0;
begin
  if not exists (
    select 1 from public.dashboard_admins da where da.user_id = auth.uid()
  ) then
    raise exception 'Acceso administrativo no autorizado';
  end if;

  if to_regclass('public.empresas') is not null then
    execute 'select count(*)::integer from public.empresas' into v_empresas;
  end if;

  select jsonb_build_object(
    'actualizado_en', now(),
    'resumen', jsonb_build_object(
      'ingresos', coalesce((select sum(coalesce(nullif(to_jsonb(t)->>'importe','')::numeric, 0)) from public.transacciones t), 0),
      'operaciones', (select count(*) from public.transacciones),
      'kg_co2', coalesce((select sum(c.kg_co2) from public.compensaciones c), 0),
      'tokens', (select count(*) from public.tokens),
      'usuarios', (select count(*) from public.usuarios),
      'viveros', (select count(*) from public.viveros),
      'lotes', (select count(*) from public.lotes_arboles),
      'arboles', coalesce((select sum(l.cantidad_actual) from public.lotes_arboles l), 0),
      'capacidad_kg', coalesce((select sum(l.cantidad_actual) * 600 from public.lotes_arboles l), 0),
      'kg_asignados', coalesce((select sum(a.kg_asignados) from public.asignaciones_lotes a), 0),
      'empresas', v_empresas
    ),
    'movimientos', coalesce((
      select jsonb_agg(x.item order by x.fecha desc)
      from (
        select jsonb_build_object(
          'id', c.id::text,
          'fecha', c.fecha,
          'kg', c.kg_co2,
          'token', tok.id,
          'origen', coalesce(to_jsonb(tr)->>'origen', 'reforestall'),
          'importe', coalesce(nullif(to_jsonb(tr)->>'importe','')::numeric, c.kg_co2 * 100)
        ) item, c.fecha
        from public.compensaciones c
        left join public.tokens tok on tok.compensacion_id = c.id
        left join public.transacciones tr on tr.id = c.transaccion_id
        order by c.fecha desc
        limit 8
      ) x
    ), '[]'::jsonb)
  ) into v_resultado;

  return v_resultado;
end;
$$;

revoke all on function public.consultar_dashboard_admin() from public, anon;
grant execute on function public.consultar_dashboard_admin() to authenticated;

-- Después de crear las cuentas administradoras, autorizarlas con:
-- insert into public.dashboard_admins (user_id)
-- select id from auth.users where lower(email) = lower('correo@ejemplo.com')
-- on conflict (user_id) do nothing;
