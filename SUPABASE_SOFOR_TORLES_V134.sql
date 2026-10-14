-- =====================================================================
-- FUVARSZERVEZO V134 – a sofor torolheti a sajat szallitolevel-fotojat
--
-- MIT CSINAL?
--   A sofori feluleten a Mentett fotok galeriajaban kuka jelent meg. Ahhoz,
--   hogy a torles a szerveren is atmenjen, a sofornek jog kell a fajl
--   torlesehez a taroloban (storage) es a nyilvantarto sor torlesehez
--   (delivery_report_files).
--
--   A jog SZUK:
--     - csak a SAJAT fuvarjanak fajljat torolheti (driver_key egyezes);
--     - csak a MAI napon (Budapest szerinti datum) - visszamenoleg es
--       elore nem. Hetvegen ezert a soforrol nem torolheto semmi.
--   Az admin jogai nem valtoznak (o eddig is torolhetett).
--
-- HASZNALAT
--   1. Supabase -> a projekted -> bal oldalt "SQL Editor"
--   2. Masold be ezt a teljes fajlt, es nyomj Run-t
--      ("Success. No rows returned" a helyes valasz)
--   A fajl tobbszor is lefuttathato, adatot nem torol.
--
-- A V133-as SUPABASE_SOFOR_MEZOK_V133.sql is kell (ha meg nem futott le).
-- =====================================================================

create or replace function public.can_delete_order_file_v134(p_order_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.orders o
      join public.allowed_users u
        on lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
     where o.id::text = p_order_id
       and u.active is true
       and (
             u.role = 'admin'
          or (o.driver_key is not distinct from u.driver_key
              and u.driver_key is not null
              and o.schedule_date = (now() at time zone 'Europe/Budapest')::date)
       )
  )
$$;

revoke all on function public.can_delete_order_file_v134(text) from public;
grant execute on function public.can_delete_order_file_v134(text) to authenticated;

-- A nyilvantarto sor torlese
drop policy if exists delivery_files_delete_v134 on public.delivery_report_files;
create policy delivery_files_delete_v134
  on public.delivery_report_files for delete
  to authenticated
  using (public.can_delete_order_file_v134(order_id::text));

-- A fajl torlese a taroloban. Az eleresi ut: <fuvar azonosito>/<jelentes>/<fajl>
drop policy if exists delivery_docs_delete_v134 on storage.objects;
create policy delivery_docs_delete_v134
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'delivery-docs'
         and public.can_delete_order_file_v134(split_part(name, '/', 1)));

-- =====================================================================
-- ELLENORZES
--   select policyname, tablename from pg_policies
--    where policyname like '%_delete_v134';
-- Ket sort kell latnod (delivery_report_files es objects).
-- =====================================================================
