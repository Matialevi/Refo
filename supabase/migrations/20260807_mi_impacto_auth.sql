create or replace function public.vincular_usuario_auth()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  update public.usuarios
  set auth_user_id = new.id
  where lower(email) = lower(new.email)
    and (auth_user_id is null or auth_user_id = new.id);

  if not found then
    insert into public.usuarios (
      nombre,
      email,
      canal_adquisicion,
      auth_user_id
    ) values (
      coalesce(new.raw_user_meta_data ->> 'nombre', split_part(new.email, '@', 1)),
      lower(new.email),
      'registro_web',
      new.id
    )
    on conflict (email) do update
    set auth_user_id = excluded.auth_user_id;
  end if;

  return new;
end;
$$;

drop trigger if exists vincular_usuario_auth_trigger on auth.users;

create trigger vincular_usuario_auth_trigger
after insert or update of email on auth.users
for each row execute function public.vincular_usuario_auth();

update public.usuarios u
set auth_user_id = au.id
from auth.users au
where lower(u.email) = lower(au.email)
  and u.auth_user_id is null;

create or replace function public.consultar_mi_impacto()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario public.usuarios%rowtype;
  v_contribuciones jsonb;
begin
  select *
  into v_usuario
  from public.usuarios
  where auth_user_id = auth.uid();

  if not found then
    return jsonb_build_object('encontrado', false);
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id::text,
        'type', 'voluntary',
        'title', case
          when tr.origen = 'mercado_pago_prueba' then 'Compensación de prueba'
          else 'Compensación Reforestall'
        end,
        'subtitle', case
          when tr.origen = 'mercado_pago_prueba' then 'Operación ficticia de Mercado Pago'
          else 'Aporte realizado desde la web'
        end,
        'date', to_char(c.fecha, 'DD/MM/YYYY'),
        'kg', c.kg_co2,
        'tokens', jsonb_build_array(tok.id),
        'nursery', 'Pendiente de asignación',
        'treeId', 'Sin lote asignado',
        'species', 'Pendiente',
        'status', case
          when exists (
            select 1 from public.asignaciones_lotes al where al.token_id = tok.id
          ) then 'Capacidad asignada'
          else 'Pendiente de asignación'
        end,
        'trace', jsonb_build_array(
          jsonb_build_object(
            'title', 'Aporte registrado',
            'description', 'La compensación fue asociada a tu cuenta.',
            'date', to_char(c.fecha, 'DD/MM/YYYY'),
            'state', 'complete'
          ),
          jsonb_build_object(
            'title', 'Token generado',
            'description', 'Se generó un token por ' || c.kg_co2 || ' kg de CO₂.',
            'date', to_char(tok.fecha_emision, 'DD/MM/YYYY'),
            'state', 'complete'
          ),
          jsonb_build_object(
            'title', 'Capacidad asignada',
            'description', case
              when exists (
                select 1 from public.asignaciones_lotes al where al.token_id = tok.id
              ) then 'El token fue vinculado a capacidad forestal disponible.'
              else 'Se asignará cuando haya capacidad forestal disponible.'
            end,
            'date', case
              when exists (
                select 1 from public.asignaciones_lotes al where al.token_id = tok.id
              ) then 'Asignada'
              else 'Pendiente'
            end,
            'state', case
              when exists (
                select 1 from public.asignaciones_lotes al where al.token_id = tok.id
              ) then 'current'
              else 'pending'
            end
          )
        )
      )
      order by c.fecha desc
    ),
    '[]'::jsonb
  )
  into v_contribuciones
  from public.compensaciones c
  join public.tokens tok on tok.compensacion_id = c.id
  left join public.transacciones tr on tr.id = c.transaccion_id
  where c.usuario_id = v_usuario.id;

  return jsonb_build_object(
    'encontrado', true,
    'usuario', jsonb_build_object(
      'name', coalesce(nullif(v_usuario.nombre, ''), split_part(v_usuario.email, '@', 1)),
      'email', v_usuario.email,
      'contributions', v_contribuciones
    )
  );
end;
$$;

revoke all on function public.consultar_mi_impacto() from public, anon;
grant execute on function public.consultar_mi_impacto() to authenticated;
