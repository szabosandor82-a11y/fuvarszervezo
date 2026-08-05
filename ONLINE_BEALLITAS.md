# Fuvarszervező V44.2 Online – beállítás

A V44.2 most közös online adatbázist használ. Emiatt a GitHub Pages fájlok feltöltése önmagában nem elég: egyszer be kell állítani egy Supabase projektet és az automatikus e-mailhez egy Resend fiókot.

## 1. Supabase projekt

1. Hozz létre egy új Supabase projektet.
2. Nyisd meg a **SQL Editor** menüt.
3. Másold be és futtasd le a `supabase/schema.sql` teljes tartalmát.
4. A script létrehozza:
   - az engedélyezett felhasználókat;
   - az online fuvarokat;
   - a fuvarátadási kérelmeket és előzményeket;
   - a szállítólevél-fotók tárolását;
   - az admin e-mail-beállítást.

## 2. GitHub-oldal összekapcsolása

A Supabase projektben keresd meg:

- **Project URL**
- **Publishable key** vagy régi nevén **anon key**

Nyisd meg az `online-config.js` fájlt, és írd be:

```js
window.FUVARSZERVEZO_ONLINE_CONFIG = {
  supabaseUrl: 'https://PROJEKT-AZONOSITO.supabase.co',
  anonKey: 'IDE_A_PUBLISHABLE_VAGY_ANON_KEY',
  pollIntervalMs: 15000,
  deliveryEmailDefault: 'szabo.sandor@stand98'
};
```

A `service_role` vagy secret kulcsot soha ne másold GitHubra.

## 3. Bejelentkezés

A Supabase **Authentication → URL Configuration** részében:

- Site URL: a GitHub Pages címed
- Redirect URL: ugyanaz a GitHub Pages cím, például:
  `https://szabosandor82-a11y.github.io/fuvarszervezo/`

Első alkalommal mindenki az alkalmazás **Első belépés** fülét használja.

- Admin: `szabo.sandor82@gmail.com`, kezdeti jelszó: `666`
- Teszt: `szabo.sandor@stand98.hu`, kezdeti jelszó: `98`
- Martin, Patrik és Márió saját, legalább 6 karakteres jelszót választanak.

Ha az e-mail-megerősítés be van kapcsolva, a felhasználó előbb megnyitja a Supabase által küldött megerősítő levelet, majd belép.

## 4. Automatikus e-mail szállítólevéllel

A fotó akkor is online elmentődik a buborékhoz, ha az e-mailküldés nincs még beállítva. Az automatikus levélhez:

1. Hozz létre egy Resend fiókot és API-kulcsot.
2. Állíts be egy hitelesített feladó címet/domaint.
3. A Supabase-ben hozd létre a `send-delivery-report` Edge Functiont a következő fájlból:
   `supabase/functions/send-delivery-report/index.ts`
4. A Function secrets részben állítsd be:
   - `RESEND_API_KEY`
   - `RESEND_FROM`, például `Fuvarszervező <fuvar@ceged.hu>`
5. Telepítsd/deployold a funkciót JWT-ellenőrzéssel.

Az e-mail tárgya automatikusan:

`Projekt neve – rendelésszám`

A címzett alapértelmezése pontosan: `szabo.sandor@stand98`.

**Figyelem:** ez a cím nem tartalmaz végződést, ezért a nyilvános e-mail-szolgáltató elutasíthatja. Az admin a **Beállítások** menüben bármikor átírhatja a teljes, működő címre.

## 5. GitHub feltöltés

A ZIP teljes tartalmát töltsd fel a `fuvarszervezo` repository gyökerébe. Fontos új fájlok:

- `online-config.js`
- `online-v44-2.js`
- `auth-v44-2.js`
- `sw.js`

A `supabase` mappát nem szükséges a GitHub Pages működéséhez feltölteni, de érdemes a repositoryban megtartani biztonsági mentésként.

Feltöltés után iPhone-on:

1. Nyisd meg Safari-ban az oldalt.
2. Frissítsd kétszer, vagy töröld a korábbi főképernyős ikont és add hozzá újra.
3. A belépőoldalon a **V44.2 Online** feliratnak kell megjelennie.

## Fuvarátadás működése

1. Martin megnyitja a buborékot, majd **Fuvar átadása**.
2. Kiválasztja Patrikot és elküldi a kérést.
3. A fuvar még Martinnál marad.
4. Patrik alkalmazásában megjelenik az **Átvételre váró fuvarok** blokk.
5. Patrik elfogadja vagy elutasítja.
6. Elfogadáskor a fuvar automatikusan Patrikhoz kerül, Martintól eltűnik.
7. Az admin **Beállítások → Fuvarátadások** részen látja a teljes előzményt.

## Szállítólevél-fotó működése

1. A sofőr a buboréknál megnyomja a **Szállítólevél** gombot.
2. Lefotózza a lapot és menti.
3. A fájl bekerül a közös, privát tárhelyre.
4. A buborék **Mentett fotók** gombjával később bármely jogosult eszközről megnyitható.
5. Az Edge Function automatikusan elküldi e-mailben is.
6. Ha az e-mailküldés hibázik, a fotó akkor is megmarad a buborékban.

## Jogosultsági védelem

A sofőrök módosításait a szerveroldali SQL-függvény is korlátozza. A mobil felhasználó nem tudja átírni a fuvar címét, projektjét, sofőrjét, dátumát vagy sorrendjét akkor sem, ha közvetlen API-kéréssel próbálkozna. Csak a tételek átvételi állapota, a tételmegjegyzés/hátralék és a szállítólevélhez tartozó metaadatok menthetők.

A hátralék miatt létrejövő új napi buborék csak egy hozzáférhető mai vagy holnapi forrásfuvarból hozható létre. A célfuvar a megadott napon válik láthatóvá a sofőrnek.

## Meglévő V44 fuvarok első feltöltése

Az első admin belépéskor, ha az online adatbázis üres, de a számítógép böngészőjében vannak V44 fuvarok, az alkalmazás felajánlja ezek online feltöltését. Válaszd az **Igen** lehetőséget. Később az admin **Beállítások → Minden fuvar online mentése** gombjával is elindítható a teljes feltöltés.

Az admin jelszó `666`, a tesztjelszó `98` csak a kért tesztelési működéshez maradt meg; éles használatnál ezek gyenge jelszavak.
