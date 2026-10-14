-- =====================================================================
-- FUVARSZERVEZO V132 – a sofori pipa es a szallitolevel-jeloles vedelme
--
-- MIERT KELL EZ?
--   A fuvar adatai egyetlen JSON mezoben (orders.payload) vannak, es ezt
--   tobb helyrol irjuk: a sofor telefonja, az admin gepe. Mindegyik a
--   TELJES fuvart kuldte fel. Ha valamelyiknel regi adat volt, az
--   felulirta a masik frissebb valtozasat - igy tunt el a sofor zold
--   pipaja, es igy veszett el a szallitolevel jelolese (a Mentett fotok
--   gomb nem zoldult be, pedig a kep megvolt).
--
-- MIT CSINAL?
--   1. union_reports_v132: ket szallitolevel-listat egyesit, azonosito
--      szerint egyszer, idorendben.
--   2. set_driver_fields_v132: a sofor a teljesitest es a szallitolevel-
--      jelolest EGYETLEN, atomi utasitassal irja. Mas mezohoz nem nyul,
--      es csak a sajat fuvarjahoz enged (az admin barmelyikhez).
--   3. orders_keep_driver_fields_v132 (trigger): BARMILYEN modositasnal
--      - a mar elmentett szallitolevel-jeloles nem veszhet el;
--      - a teljesites csak akkor all vissza, ha a visszavonas idobelyege
--        (completedUndoneAtV132) KESOBBI, mint a teljesitese. Egy regi
--        adatpeldany pipa nelkuli allapota tehat nem torolheti a pipat.
--
--   A program e nelkul is mukodik (a V132 kliens oldalon is vedekezik),
--   de a szerveroldali vedelem a legbiztosabb.
--
-- HASZNALAT
--   1. Supabase -> a projekted -> bal oldalt "SQL Editor"
--   2. Masold be ezt a teljes fajlt, es nyomj Run-t
--      ("Success. No rows returned" a helyes valasz)
--   3. Data API -> Settings -> Exposed functions: kapcsold be a
--      set_driver_fields_v132 fuggvenyt is (ha ez a lista nalatok latszik)
--   A fajl tobbszor is lefuttathato, adatot nem torol.
-- =====================================================================

create or replace function public.union_reports_v132(a jsonb, b jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_agg(r order by coalesce(r ->> 'at', ''), k), '[]'::jsonb)
  from (
    select distinct on (k) k, r
    from (
      select coalesce(e ->> 'id', e ->> 'at', e::text) as k, e as r, src
      from (
        select e, 1 as src
          from jsonb_array_elements(case when jsonb_typeof(a) = 'array' then a else '[]'::jsonb end) as e
        union all
        select e, 2 as src
          from jsonb_array_elements(case when jsonb_typeof(b) = 'array' then b else '[]'::jsonb end) as e
      ) u
    ) x
    order by k, src desc
  ) y
$$;

create or replace function public.set_driver_fields_v132(
  p_order_id text,
  p_fields   jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email      text;
  v_role       text;
  v_driver_key text;
  v_order      record;
  v_fields     jsonb := coalesce(p_fields, '{}'::jsonb);
begin
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  if v_email = '' then
    raise exception 'Nincs belepett felhasznalo.';
  end if;

  select role, driver_key
    into v_role, v_driver_key
    from public.allowed_users
   where lower(email) = v_email
     and active is true;

  if v_role is null then
    raise exception 'Ez az e-mail-cim nincs engedelyezve.';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'A fuvar nem talalhato.';
  end if;

  if v_role <> 'admin' and v_order.driver_key is distinct from v_driver_key then
    raise exception 'Ehhez a fuvarhoz nincs jogosultsagod.';
  end if;

  -- Egyetlen UPDATE: a payload tobbi resze valtozatlan marad, a
  -- szallitolevelek a meglevokhoz adodnak hozza.
  update public.orders
     set payload = coalesce(payload, '{}'::jsonb)
                   || jsonb_build_object(
                        'completed',             coalesce(v_fields -> 'completed', 'false'::jsonb),
                        'completedAt',           coalesce(v_fields -> 'completedAt', '""'::jsonb),
                        'completedAtV111',       coalesce(v_fields -> 'completedAtV111', '""'::jsonb),
                        'completedUndoneAtV132', coalesce(v_fields -> 'completedUndoneAtV132', '""'::jsonb),
                        'deliveryReports',       public.union_reports_v132(payload -> 'deliveryReports', v_fields -> 'deliveryReports')
                      ),
         updated_at = now()
   where id = p_order_id;
end;
$$;

revoke all on function public.set_driver_fields_v132(text, jsonb) from public;
grant execute on function public.set_driver_fields_v132(text, jsonb) to authenticated;

create or replace function public.orders_keep_driver_fields_v132()
returns trigger
language plpgsql
as $$
declare
  v_old  jsonb := coalesce(old.payload, '{}'::jsonb);
  v_new  jsonb := coalesce(new.payload, '{}'::jsonb);
  v_done text;
begin
  -- 1. a szallitolevel-jeloles nem veszhet el
  if jsonb_typeof(v_old -> 'deliveryReports') = 'array'
     and jsonb_array_length(v_old -> 'deliveryReports') > 0 then
    v_new := jsonb_set(v_new, '{deliveryReports}',
               public.union_reports_v132(v_old -> 'deliveryReports', v_new -> 'deliveryReports'), true);
  end if;

  -- 2. a pipa csak kesobbi, tudatos visszavonassal tunhet el
  if (v_old -> 'completed') = 'true'::jsonb
     and coalesce(v_new -> 'completed', 'false'::jsonb) <> 'true'::jsonb then
    v_done := coalesce(nullif(v_old ->> 'completedAt', ''), nullif(v_old ->> 'completedAtV111', ''), '');
    if coalesce(v_new ->> 'completedUndoneAtV132', '') <= v_done then
      v_new := v_new
        || jsonb_build_object('completed', true)
        || jsonb_strip_nulls(jsonb_build_object(
             'completedAt',     v_old -> 'completedAt',
             'completedAtV111', v_old -> 'completedAtV111'));
    end if;
  end if;

  new.payload := v_new;
  return new;
end;
$$;

drop trigger if exists orders_keep_driver_fields_v132 on public.orders;
create trigger orders_keep_driver_fields_v132
  before update on public.orders
  for each row
  execute function public.orders_keep_driver_fields_v132();

-- =====================================================================
-- ELLENORZES
--
-- Egy fuvar pipaja es szallitolevelei:
--
--   select order_no, payload -> 'completed' as kesz,
--          payload ->> 'completedAt' as mikor,
--          jsonb_array_length(coalesce(payload -> 'deliveryReports', '[]')) as szallitolevel
--     from public.orders
--    where order_no = '006808';
--
-- Fuvarok, amelyekhez van feltoltott fajl, de a jeloles hianyzik:
--
--   select o.order_no, o.schedule_date, count(f.id) as fajl
--     from public.orders o
--     join public.delivery_report_files f on f.order_id = o.id
--    where jsonb_array_length(coalesce(o.payload -> 'deliveryReports', '[]')) = 0
--    group by o.order_no, o.schedule_date
--    order by o.schedule_date desc;
-- =====================================================================
