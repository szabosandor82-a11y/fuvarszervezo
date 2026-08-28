# Fuvarszervező V51 – Supabase ellenőrzőlista

## Meglévő beállítások

- A Project URL és a publishable key az `online-config.js` fájlban szerepel.
- Authentication → Email provider: engedélyezve.
- Az öt engedélyezett felhasználó az Authentication → Users és az `allowed_users` táblában szerepel.
- A szükséges táblák, Data API-függvények és a `delivery-docs` Storage bucket rendelkezésre állnak.
- A táblák és a Storage hozzáférése `authenticated` szerepkörhöz kötött.

## V51: e-mailes belépési link

A V51 nem kér jelszót. Az e-mail-cím beküldése után a Supabase egyszer használható
belépési linket küld. A link megnyitásakor hitelesített munkamenet jön létre, ezért
nem kell nyilvános `anon` írási jogosultságot adni az adatbázishoz.

Ellenőrizd a Supabase Dashboardon:

1. Authentication → Providers → Email legyen engedélyezve.
2. Authentication → URL Configuration → Site URL:
   `https://szabosandor82-a11y.github.io/fuvarszervezo/`
3. Ugyanez az URL szerepeljen az engedélyezett Redirect URLs listában is.
4. Authentication → Email Templates → Magic Link sablon tartalmazza a
   `{{ .ConfirmationURL }}` hivatkozást.

A V51 `create_user: false` beállítással kér linket, ezért ismeretlen e-mail-címhez
nem hoz létre új felhasználót.

## Adatbázis és Data API

A ZIP-ben található `supabase/schema.sql` idempotens. Szükség esetén a Supabase
SQL Editorban újra lefuttatható; a meglévő fuvaradatokat nem törli.

A Data API → Settings → Exposed functions résznél ezek legyenek engedélyezve:

1. `update_own_order_payload`
2. `sync_own_orders`
3. `sync_own_backlog`
4. `request_transfer`
5. `accept_transfer`
6. `reject_transfer`
7. `cancel_transfer`

## Gyors ellenőrzés

1. Töltsd fel a V51 fájljait GitHub Pages-re.
2. Kérj belépési linket az admin e-mail-címre, és nyisd meg.
3. Ellenőrizd, hogy az adminfelület és a közös fuvaradatok betöltődnek.
4. Másik eszközön kérj linket egy sofőrfiókhoz.
5. Ellenőrizd, hogy a sofőr csak a saját mai és következő munkanapi fuvarjait látja.
6. Ments egy szállítólevél-fotót, majd nyisd meg a Mentett fotók nézetet.

## Fontos

Az `online-config.js` fájlba csak Project URL és publishable key kerülhet.
Secret vagy service_role kulcsot soha ne tölts fel GitHubra.

