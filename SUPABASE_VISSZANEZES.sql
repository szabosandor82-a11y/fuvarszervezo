-- =====================================================================
-- FUVARSZERVEZO – a sofor visszanezhesse a korabbi fuvarjait
--
-- HIBA: a sofori feluleten a datumvalasztoval egy regebbi napra lepve URES
--       a lista, pedig voltak aznap fuvarok.
--
-- MIERT?
--   A program oldalan nincs hiba: a datumvalaszto beallitja a napot es
--   ujrarajzol. A REGI FUVAROK viszont le sem toltodnek a telefonra - a
--   szerver a sofornek csak az engedelyezett napokat (tegnap, ma, holnap)
--   adja ki. Ez a V52 ota igy van, es szandekos volt.
--
--   A V113-ban kinyitottuk a MEGTEKINTEST a programban, de a szerver
--   tovabbra sem kuldi a regi adatot.
--
--   Ez a fajl az OLVASAST nyitja ki: a sofor lassa a sajat autojanak
--   korabbi fuvarjait. Az IRAS valtozatlanul a mai napra korlatozodik - azt
--   a program es a sync_own_orders eljaras egyuttesen orzi.
--
-- HASZNALAT
--   1. Supabase -> a projekted -> bal oldalt "SQL Editor"
--   2. Masold be ezt a teljes fajlt, es nyomj Run-t
--   3. A sofori feluleten lepj vissza egy korabbi napra
-- =====================================================================

-- A sofor sajat kulcsa az allowed_users tablabol.
create or replace function public.my_driver_key()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.driver_key from public.allowed_users u
   where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
     and u.active is true
   limit 1;
$$;

revoke all on function public.my_driver_key() from public;
grant execute on function public.my_driver_key() to authenticated;


-- OLVASAS: az admin mindent lat; a sofor a SAJAT autoja fuvarjait, idobeli
-- korlat nelkul visszafele. Elore a kovetkezo munkanapig - a tavolabbi
-- terveket ne lassa, mert azok meg valtozhatnak.
drop policy if exists "orders_driver_read_history" on public.orders;
create policy "orders_driver_read_history"
  on public.orders for select
  to authenticated
  using (
    public.is_admin_user()
    or (
      driver_key is not null
      and driver_key = public.my_driver_key()
      and schedule_date <= (current_date + interval '3 days')::date::text
    )
  );


-- =====================================================================
-- ELLENORZES
--
-- Sofori e-mail-cimmel belepve ennek a sajat kulcsat kell adnia:
--
--   select public.my_driver_key();
--
-- A szabalyrol:
--
--   select policyname, cmd from pg_policies
--    where tablename = 'orders';
--
-- MEGJEGYZES: ha a regi olvasasi szabaly mas neven letezik es szukebb, azt
-- is at kell nezni - ket SELECT szabaly kozul a bovebb ervenyesul, tehat ez
-- a fajl onmagaban eleg. Ha megsem latszanak a regi fuvarok, a
-- pg_policies listaja megmutatja, mi van meg a tablan.
-- =====================================================================
