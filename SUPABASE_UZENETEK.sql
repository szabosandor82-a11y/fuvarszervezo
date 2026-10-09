-- =====================================================================
-- FUVARSZERVEZO – a sofori uzenetek feljutasa
--
-- MIERT KELL EZ?
--   A sofor mentese a sync_own_orders eljarason megy at, ami biztonsagi
--   okbol CSAK bizonyos mezoket enged at a fuvaron: a teteleket, a
--   hatralekot es a fotokat. Az uzenetszal uj mezo (threadV115), ezert a
--   szerver eldobta - az adminhoz sosem ert el. Forditva mukodott, mert az
--   admin a teljes fuvart irja.
--
--   A program eloszor az update_own_order_payload eljarassal probalkozik,
--   ami a TELJES fuvart irja. Ha az nalatok is szurne a mezoket, futtasd le
--   ezt a fajlt: letrehoz egy kulon, szuk celu eljarast CSAK az uzenetekre.
--
-- HASZNALAT
--   1. Supabase -> a projekted -> bal oldalt "SQL Editor"
--   2. Masold be ezt a fajlt, es nyomj Run-t
--   3. Data API -> Settings -> Exposed functions: engedelyezd a
--      sync_order_thread fuggvenyt is
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
  v_role        text;
  v_driver_key  text;
  v_order       record;
begin
  -- ki vagyok?
  select role, driver_key into v_role, v_driver_key
  from public.profiles where id = auth.uid();

  if v_role is null then
    raise exception 'Ismeretlen felhasznalo.';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'A fuvar nem talalhato.';
  end if;

  -- az admin barmelyik fuvarhoz irhat; a sofor csak a sajatjahoz
  if v_role <> 'admin' and v_order.driver_key is distinct from v_driver_key then
    raise exception 'Ehhez a fuvarhoz nincs jogosultsagod.';
  end if;

  -- CSAK az uzenetszalat irjuk at, mast nem
  update public.orders
     set payload = payload
                   || jsonb_build_object('threadV115', coalesce(p_thread, '[]'::jsonb))
                   || jsonb_build_object('threadDeletedV115', coalesce(p_deleted, '[]'::jsonb)),
         updated_at = now()
   where id = p_order_id;
end;
$$;

revoke all on function public.sync_order_thread(text, jsonb, jsonb) from public;
grant execute on function public.sync_order_thread(text, jsonb, jsonb) to authenticated;

-- Megjegyzes: a NAP szerinti korlatozast szandekosan NEM tesszuk ide. Azt a
-- program vegzi (a sofor csak a mai napi fuvarhoz ir), itt viszont hasznos,
-- ha egy kesobbi javitas vagy az admin valasza akkor is atmegy.
