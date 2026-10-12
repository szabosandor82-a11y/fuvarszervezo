# Fuvarszervező V52 – Supabase ellenőrzőlista

## Meglévő beállítások

- A Project URL és a publishable key az `online-config.js` fájlban szerepel.
- Authentication → Email provider: engedélyezve.
- Az öt engedélyezett felhasználó az Authentication → Users és az `allowed_users` táblában szerepel.
- A szükséges táblák, Data API-függvények és a `delivery-docs` Storage bucket rendelkezésre állnak.
- A táblák és a Storage hozzáférése `authenticated` szerepkörhöz kötött.

## V52: e-mail–jelszó belépés

A V52 az e-mail-címet és a jelszót közvetlenül a Supabase Auth szolgáltatásának
küldi el. A jelszó nem kerül a GitHub Pages fájljaiba vagy az adatbázis
`allowed_users` táblájába. Sikeres belépéskor hitelesített munkamenet jön létre,
ezért nem kell nyilvános `anon` írási jogosultságot adni az adatbázishoz.

Ellenőrizd a Supabase Dashboardon:

1. Authentication → Providers → Email legyen engedélyezve.
2. Authentication → Users alatt mind az öt engedélyezett e-mail-cím létezzen.
3. Meglévő felhasználónál a sor jobb oldali hárompontos menüjében válaszd a
   Send password recovery műveletet; a felhasználó a levélben állítja be a jelszót.
4. Új felhasználónál Authentication → Users → Add user → Create new user alatt
   add meg az e-mail-címet és a jelszót.
5. Authentication → Providers → Email alatt a Confirm Email beállítást a saját
   működésetekhez igazítsd. A Dashboardból kézzel létrehozott felhasználót erősítsd
   meg, ha a felület erre lehetőséget ad.

Legalább 8 karakteres, egyedi jelszó ajánlott. A jelszavak nem azonosak a Supabase
Dashboard-fiók vagy a Postgres-adatbázis jelszavával.

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

1. Töltsd fel a V52 fájljait GitHub Pages-re.
2. Lépj be az admin e-mail-címével és a Supabase Auth alatt beállított jelszóval.
3. Ellenőrizd, hogy az adminfelület és a közös fuvaradatok betöltődnek.
4. Másik eszközön lépj be egy sofőrfiók e-mail-címével és jelszavával.
5. Ellenőrizd, hogy a sofőr csak a saját mai és következő munkanapi fuvarjait látja.
6. Ments egy szállítólevél-fotót, majd nyisd meg a Mentett fotók nézetet.

## Fontos

Az `online-config.js` fájlba csak Project URL és publishable key kerülhet.
Secret vagy service_role kulcsot soha ne tölts fel GitHubra.
