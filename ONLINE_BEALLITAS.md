# Fuvarszervező V49 – Supabase ellenőrzőlista

## Ami már be van állítva

- Project URL: `https://eswwxncdystrqzqzbkto.supabase.co`
- Publishable key: az `online-config.js` fájlban kitöltve.
- Authentication → Email provider: engedélyezve.
- Site URL / Redirect URL: `https://szabosandor82-a11y.github.io/fuvarszervezo/`
- Az öt felhasználó létrehozva az Authentication → Users alatt.
- A nyolc szükséges tábla létrehozva.
- Data API → Exposed tables: 8 / 8.
- Storage bucket: `delivery-docs`.
- Storage INSERT és SELECT policy: authenticated.

## Még 1: belépési jelszavak

A V47 nem tárol jelszót a nyilvános forráskódban. A belépés közvetlenül a Supabase Authtal történik.

Az admin fiók: `szabo.sandor82@gmail.com`
Teszt/mobil fiók: `szabo.sandor@stand98.hu`

A két tényleges jelszót a Supabase Authentication → Users alatt kell beállítani. A V47 a beírt
e-mailt és jelszót változtatás nélkül a Supabase Auth felé küldi; jelszó nincs a GitHub-fájlokban.

## Még 2: V47 adatbázis-frissítés

A V47 az online törzsadat-szinkronhoz egy új `master_data` táblát használ. A Supabase SQL Editorban
futtasd le egyszer a ZIP-ben található frissített `supabase/schema.sql` fájlt. A script idempotens,
ezért a már meglévő táblákat és fuvaradatokat nem törli. Ezután az admin törzsmódosításai a
Supabase-be is mentődnek, így a következő verzió már ebből a friss törzsből tud továbbindulni.

## Még 3: a szükséges Data API függvények engedélyezése

A Data API → Settings → **Exposed functions** résznél jelöld be ezt a 7 függvényt, majd Save:

1. `update_own_order_payload`
2. `sync_own_orders`
3. `sync_own_backlog`
4. `request_transfer`
5. `accept_transfer`
6. `reject_transfer`
7. `cancel_transfer`

A többi segédfüggvényt nem kell külön kitenni a Data API-ra.

Ez a lépés azért kell, hogy a sofőrök tételmódosítása, hátraléka és fuvarátadása is
biztonságosan a szerveroldali RPC függvényeken keresztül menjen.

## Gyors ellenőrzés

1. GitHub Pages frissítés után nyisd meg a V47-et.
2. Lépj be adminnal.
3. Hozz létre vagy nyiss meg egy mai/holnapi rendelést.
4. Sofőrrel lépj be egy másik eszközön.
5. Készíts egy szállítólevél-fotót és mentsd a rendeléshez.
6. Nyomd meg a „Mentett fotók” gombot; a képnek meg kell jelennie.
7. Ellenőrizd, hogy a másik eszköz frissítés után ugyanazt a rendelésállapotot látja.

## Fontos

Az `online-config.js` fájlba csak Project URL és publishable key kerülhet.
Secret/service_role kulcsot soha ne tölts fel GitHubra.
