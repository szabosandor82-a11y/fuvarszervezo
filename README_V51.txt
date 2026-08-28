FUVAR­SZERVEZŐ V51 – MOBIL PWA
============================

Belépés:
- Az admin, a három sofőr és a tesztfelhasználó e-mailes belépési linket kér.
- A felületen nincs jelszómező vagy jelszómódosító gomb.
- A link csak már létrehozott, engedélyezett felhasználóhoz kérhető.

Jogosultságok:
- Admin: minden adatot és funkciót elér.
- Sofőr: csak a saját mai és következő munkanapi fuvarjait látja.
- Tesztfelhasználó: minden sofőr mai és következő munkanapi fuvarját látja.
- Sofőr és teszt: az alapadatokat, sofőrt, sorrendet és törzsadatot nem szerkesztheti.
- Tételek, hátralék, fuvarátadás és szállítólevél-fotó a korábbi szabályok szerint kezelhető.

Telepítés telefonra:
- Android/Chrome: Menü → Alkalmazás telepítése / Hozzáadás a kezdőképernyőhöz.
- iPhone/Safari: Megosztás → Hozzáadás a Főképernyőhöz.

Az admin és a telefonok ugyanazt a Supabase-adatbázist használják. A linkes belépés
megtartja a hitelesített munkamenetet és a meglévő RLS-jogosultságokat.

