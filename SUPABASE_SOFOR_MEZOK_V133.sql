-- =====================================================================
-- FUVARSZERVEZO V133 – a sofori pipa es a szallitolevel-jeloles vedelme
--
-- A V132-es fajl UTODJA: ha azt mar lefuttattad, ezt is futtasd le, mert
-- a V132-es trigger nem engedi levenni a torolt szallitolevel jeloleset.
-- Ha meg egyiket sem futtattad, eleg ez az egy.
--
-- MIT CSINAL?
--   1. union_reports_v133: ket szallitolevel-listat egyesit azonosito
--      szerint, idorendben. A TOROLT bejegyzes (deliveryReportsDeletedV133)
--      nem jon vissza, az ARCHIVALT jeloles (archivedAtV133) megmarad.
--   2. set_driver_fields_v132: a sofor a teljesitest es a szallitolevel-
--      jelolest EGYETLEN, atomi utasitassal irja (csak a sajat fuvarjat).
--   3. orders_keep_driver_fields_v132 (trigger): barmilyen modositasnal
--      - a szallitolevel-jeloles csak tudatos torlessel tunhet el;
--      - a pipa csak kesobbi, tudatos visszavonassal tunhet el.
--
-- HASZNALAT
--   1. Supabase -> a projekted -> bal oldalt "SQL Editor"
--   2. Masold be ezt a teljes fajlt, es nyomj Run-t
--      ("Success. No rows returned" a helyes valasz)
--   3. Data API -> Settings -> Exposed functions: a set_driver_fields_v132
--      legyen bekapcsolva (ha ez a lista nalatok latszik)
--   A fajl tobbszor is lefuttathato, adatot nem torol.
-- =====================================================================

create or replace function public.union_reports_v133(a jsonb, b jsonb, deleted jsonb default '[]'::jsonb)
returns jsonb
language sql
immutable
as $$
  with
  ra as (
    select distinct on (k) k, e from (
      select coalesce(e ->> 'id', e ->> 'at', e::text) as k, e, n
        from jsonb_array_elements(case when jsonb_typeof(a) = 'array' then a else '[]'::jsonb end) with ordinality as t(e, n)
    ) x order by k, n desc
  ),
  rb as (
    select distinct on (k) k, e from (
      select coalesce(e ->> 'id', e ->> 'at', e::text) as k, e, n
        from jsonb_array_elements(case when jsonb_typeof(b) = 'array' then b else '[]'::jsonb end) with ordinality as t(e, n)
    ) x order by k, n desc
  ),
  dl as (
    select jsonb_array_elements_text(case when jsonb_typeof(deleted) = 'array' then deleted else '[]'::jsonb end) as k
  ),
  j as (
    select coalesce(rb.k, ra.k) as k,
           case
             when rb.e is null then ra.e
             when ra.e is null then rb.e
             when (ra.e ? 'archivedAtV133') and not (rb.e ? 'archivedAtV133')
               then ra.e || rb.e || jsonb_build_object('archivedAtV133', ra.e -> 'archivedAtV133')
             else ra.e || rb.e
           end as r
      from ra full outer join rb on ra.k = rb.k
  )
  select coalesce(jsonb_agg(r order by coalesce(r ->> 'at', ''), k), '[]'::jsonb)
    from j
   where k not in (select k from dl)
$$;

create or replace function public.union_text_v133(a jsonb, b jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_agg(distinct x), '[]'::jsonb)
    from (
      select jsonb_array_elements_text(case when jsonb_typeof(a) = 'array' then a else '[]'::jsonb end) as x
      union
      select jsonb_array_elements_text(case when jsonb_typeof(b) = 'array' then b else '[]'::jsonb end)
    ) s
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
                        'deliveryReportsDeletedV133', public.union_text_v133(payload -> 'deliveryReportsDeletedV133', v_fields -> 'deliveryReportsDeletedV133'),
                        'deliveryReports',       public.union_reports_v133(
                                                   payload -> 'deliveryReports', v_fields -> 'deliveryReports',
                                                   public.union_text_v133(payload -> 'deliveryReportsDeletedV133', v_fields -> 'deliveryReportsDeletedV133'))
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
  v_deleted jsonb;
begin
  -- 1. a szallitolevel-jeloles csak tudatos torlessel tunhet el
  v_deleted := public.union_text_v133(v_old -> 'deliveryReportsDeletedV133', v_new -> 'deliveryReportsDeletedV133');
  if (jsonb_typeof(v_old -> 'deliveryReports') = 'array' and jsonb_array_length(v_old -> 'deliveryReports') > 0)
     or jsonb_array_length(v_deleted) > 0 then
    v_new := jsonb_set(v_new, '{deliveryReports}',
               public.union_reports_v133(v_old -> 'deliveryReports', v_new -> 'deliveryReports', v_deleted), true);
    if jsonb_array_length(v_deleted) > 0 then
      v_new := jsonb_set(v_new, '{deliveryReportsDeletedV133}', v_deleted, true);
    end if;
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
