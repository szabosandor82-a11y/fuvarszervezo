FUVAR­SZERVEZŐ V52 – MOBIL PWA
============================

Belépés:
- Az admin, a három sofőr és a tesztfelhasználó e-mail-címmel és jelszóval lép be.
- A jelszavakat a Supabase Dashboard → Authentication → Users alatt kell beállítani.
- A csomag és a GitHubra feltöltött forrás nem tartalmaz jelszót.

Jogosultságok:
- Admin: minden adatot és funkciót elér.
- Sofőr: csak a saját mai és következő munkanapi fuvarjait látja.
- Tesztfelhasználó: minden sofőr mai és következő munkanapi fuvarját látja.
- Sofőr és teszt: az alapadatokat, sofőrt, sorrendet és törzsadatot nem szerkesztheti.
- Tételek, hátralék, fuvarátadás és szállítólevél-fotó a korábbi szabályok szerint kezelhető.

Telepítés telefonra:
- Android/Chrome: Menü → Alkalmazás telepítése / Hozzáadás a kezdőképernyőhöz.
- iPhone/Safari: Megosztás → Hozzáadás a Főképernyőhöz.

Az admin és a telefonok ugyanazt a Supabase-adatbázist használják. A jelszavas
belépés hitelesített munkamenetet hoz létre, ezért a meglévő RLS-jogosultságok
változatlanul működnek.
