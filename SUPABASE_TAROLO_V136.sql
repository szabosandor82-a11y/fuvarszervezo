-- =====================================================================
-- FUVARSZERVEZO V136 – a levelmellekletek tipusai a taroloban
--
-- MIERT KELL EZ?
--   A "delivery-docs" tarolo csak megadott fajltipusokat enged (JPEG, PNG,
--   HEIC, HEIF, PDF, hang). A levelekhez csatolt Outlook-level (.msg),
--   Word, Excel es CSV mellekletet ezert elutasitotta. Mivel egyetlen
--   elutasitott fajl az egesz feltoltest elbuktatta, a sofor a level egyik
--   mellekletet sem latta.
--
-- MIT CSINAL?
--   - A meglevo engedelyezett tipusok MEGMARADNAK, es kiegeszulnek:
--     Outlook-level, .eml, Word, Excel, CSV, szoveg, GIF, WebP, valamint
--     az ismeretlen tipusu fajl (application/octet-stream).
--   - A merethatar legalabb 50 MB lesz (az ingyenes csomag felso hatara).
--     Ha mar most nagyobb, nem csokkentjuk.
--   - Ha a taroloban nincs tipuskorlat (minden tipus engedett), az ugy marad.
--
-- HASZNALAT
--   1. Supabase -> a projekted -> bal oldalt "SQL Editor"
--   2. Masold be ezt a teljes fajlt, es nyomj Run-t
--   3. A vegen megjelenik a tarolo uj beallitasa
--   A fajl tobbszor is lefuttathato, adatot nem torol.
--
-- UTANA: az importalo gepen Beallitasok -> "Hianyzo mellekletek feltoltese
-- a soforoknek" gomb.
-- =====================================================================

update storage.buckets
   set allowed_mime_types = case
         when allowed_mime_types is null then null
         else (
           select array_agg(distinct t order by t)
             from unnest(allowed_mime_types || array[
               'application/pdf',
               'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/gif', 'image/webp',
               'application/vnd.ms-outlook',
               'message/rfc822',
               'application/msword',
               'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
               'application/vnd.ms-excel',
               'application/vnd.ms-excel.sheet.macroEnabled.12',
               'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
               'text/csv',
               'text/plain',
               'application/octet-stream',
               'audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg'
             ]::text[]) as t
         )
       end,
       file_size_limit = greatest(coalesce(file_size_limit, 0), 52428800)
 where id = 'delivery-docs';

-- ELLENORZES: a tarolo uj beallitasa
select id, file_size_limit, allowed_mime_types
  from storage.buckets
 where id = 'delivery-docs';
