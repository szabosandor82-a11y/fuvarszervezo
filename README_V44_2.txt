FUVAR­SZERVEZŐ V44 / V44.2 – MOBIL PWA
=====================================

Jelölés:
- Admin felület: V44
- Sofőr / teszt felület: V44.2

Engedélyezett fiókok:
- schmidt.martin@stand98.hu – Martin, első belépéskor saját jelszót állít be
- polgar.patrik@stand98.hu – Patrik, első belépéskor saját jelszót állít be
- berki.mario@stand98.hu – Márió, első belépéskor saját jelszót állít be
- szabo.sandor82@gmail.hu – admin, kezdeti jelszó: 666
- szabo.sandor@stand98.hu – teszt felhasználó, jelszó: 98

Jogosultságok:
- Admin: a teljes V44 felületet látja és használja.
- Sofőr: csak a saját mai és holnapi fuvarbuborékait látja.
- Teszt felhasználó: az összes sofőr mai és holnapi buborékait látja.
- Sofőr és teszt: fuvaradatot, sofőrt, sorrendet és törzsadatot nem szerkeszthet.
- Sofőr és teszt: tételpipálás, tételmegjegyzés, tételszintű hátralék és szállítólevél-fotó engedélyezett.

Telepítés telefonra:
- Android/Chrome: Menü → Alkalmazás telepítése / Hozzáadás a kezdőképernyőhöz.
- iPhone/Safari: Megosztás → Hozzáadás a Főképernyőhöz.

FONTOS TECHNIKAI KORLÁT:
Ez a csomag GitHub Pages-en, szerver nélkül fut. A belépési adatok, jelszavak,
fuvaradatok és fotók az adott böngésző/eszköz helyi tárhelyén vannak. Emiatt:
- a kliensoldali beléptetés nem tekinthető biztonságos éles hitelesítésnek;
- külön telefonok nem látják automatikusan az admin gépén lévő fuvarokat;
- a fotók is csak azon az eszközön érhetők el, ahol készültek.

Valódi többfelhasználós, közös online működéshez szerveroldali hitelesítés és
közös adatbázis szükséges (például Supabase/Firebase saját projekttel).
