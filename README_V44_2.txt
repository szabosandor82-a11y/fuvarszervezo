FUVAR­SZERVEZŐ V44 / V44.2 ONLINE
================================

Jelölés:
- Admin felület: V44
- Sofőr / teszt mobilfelület: V44.2 Online

Fiókok:
- schmidt.martin@stand98.hu – Martin, első belépéskor saját jelszó
- polgar.patrik@stand98.hu – Patrik, első belépéskor saját jelszó
- berki.mario@stand98.hu – Márió, első belépéskor saját jelszó
- szabo.sandor82@gmail.com – admin, belépési jelszó: 666
- szabo.sandor@stand98.hu – tesztfelhasználó, belépési jelszó: 98

Online működés:
- Az admin gépén mentett fuvarok közös Supabase adatbázisba kerülnek.
- A sofőrök a saját mai és holnapi fuvarjaikat látják.
- A tesztfelhasználó mindhárom sofőr mai és holnapi fuvarjait látja.
- A tételpipálás és a tételszintű hátralék online szinkronizálódik.
- A szállítólevél-fotók közös privát tárhelyre kerülnek, később a buborékból megnyithatók.
- A fuvarátadás csak a célsofőr elfogadása után hajtódik végre.
- Az admin a Beállítások menüben látja a teljes átadási előzményt és módosíthatja a szállítólevél e-mail címzettjét.

Jogosultságok:
- Admin: teljes V44 felület.
- Sofőr: fuvaradatot, sofőrt, sorrendet és törzsadatot nem szerkeszthet.
- Sofőr: tételek, hátralék, megjegyzés, kamera, mentett fotók és fuvarátadási kérés.
- Teszt: a mai/holnapi buborékoknál ugyanazok a tesztfunkciók.

FONTOS:
A működéshez egyszer be kell állítani a Supabase hátteret. Az automatikus e-mailhez Resend fiók és Supabase Edge Function szükséges. Részletes lépések: ONLINE_BEALLITAS.md

ONLINE MŰKÖDÉS
- A külön eszközök közötti fuvarszinkronhoz a Supabase beállítása kötelező.
- A pontos lépések az ONLINE_BEALLITAS.md fájlban találhatók.
- Első admin belépéskor az üres online adatbázisba feltölthetők a meglévő helyi V44 fuvarok.
- A szállítólevél e-mailhez Resend Edge Function szükséges.
- Az alapértelmezett címzett a kérés szerint szabo.sandor@stand98, de a végződés nélküli címet az e-mail szolgáltató várhatóan elutasítja; az admin Beállításokban javíthatja.
