-- =====================================================================
-- FUVARSZERVEZO – a sofori uzenetek feljutasa
--
-- MIERT KELL EZ?
--   A sofor mentese a sync_own_orders eljarason megy at, ami biztonsagi
--   okbol CSAK bizonyos mezoket enged modositani a fuvaron: a teteleket, a
--   hatralekot es a fotokat. Ez SZANDEKOS: a telefonrol ne lehessen atirni
--   a soforkiosztast, a napot, a sorrendet vagy a cimeket.
--
--   Az uzenetszal (threadV115) UJ mezo, ezert nem szerepel az engedelyezett
--   listan - a szerver eldobja. Az ADMIN irasa azert jut at, mert az admin
--   kozvetlenul irja a fuvar sorat, szures nelkul.
--
--   Ez a fajl egy SZUK CELU eljarast hoz letre: kizarolag az uzenetszalat
--   irja, mas mezohoz nem nyul, es mas sofor fuvarjahoz sem enged.
--
-- HASZNALAT
--   1. Supabase -> a projekted -> bal oldalt "SQL Editor"
--   2. Masold be ezt a teljes fajlt, es nyomj Run-t
--   3. Data API -> Settings -> Exposed functions: kapcsold be a
--      sync_order_thread fuggvenyt is
--   4. A programban a sofor irjon egy uzenetet, te pedig nyomj Frissites-t
-- =====================================================================

create or replace function public.sync_order_thread(
  p_order_id text,
  p_thread   jsonb,
  p_deleted  jsonb default '[]'::jsonb
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
begin
  -- Ki ir? A belepett felhasznalo e-mail-cime alapjan, az allowed_users
  -- tablabol - ugyanonnan, ahonnan a program is olvassa a jogosultsagot.
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

  -- Az admin barmelyik fuvarhoz irhat; a sofor CSAK a sajatjahoz.
  if v_role <> 'admin' and v_order.driver_key is distinct from v_driver_key then
    raise exception 'Ehhez a fuvarhoz nincs jogosultsagod.';
  end if;

  -- CSAK az uzenetszalat irjuk at. A payload tobbi resze valtozatlan marad,
  -- mert a || operator a megadott kulcsokat csereli, a tobbit meghagyja.
  update public.orders
     set payload = coalesce(payload, '{}'::jsonb)
                   || jsonb_build_object('threadV115',        coalesce(p_thread,  '[]'::jsonb))
                   || jsonb_build_object('threadDeletedV115', coalesce(p_deleted, '[]'::jsonb)),
         updated_at = now()
   where id = p_order_id;
end;
$$;

revoke all on function public.sync_order_thread(text, jsonb, jsonb) from public;
grant execute on function public.sync_order_thread(text, jsonb, jsonb) to authenticated;

-- =====================================================================
-- ELLENORZES
--
-- Ezzel a lekerdezessel megnezheted, hogy egy fuvarnal megvan-e a szal:
--
--   select id, order_no, payload -> 'threadV115' as uzenetek
--     from public.orders
--    where order_no = '006808';
--
-- Ha ures vagy nincs ilyen kulcs, akkor a sofor telefonjarol meg nem jutott
-- fel - ilyenkor a bongeszo konzoljan keresd a [V117] kezdetu sorokat.
-- =====================================================================
