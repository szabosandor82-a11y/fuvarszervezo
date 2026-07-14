FUVAR-SZERVEZŐ V8
==================

A V8 már valódi, többfelhasználós rendszer:

ADMIN
- csak az admin látja a teljes fuvarszervező felületet;
- látja mindhárom sofőr feladatait, térképeit, importot és törzsadatokat;
- külön „Felhasználók” menüpontban létrehozhat, szerkeszthet, inaktiválhat és törölhet felhasználókat;
- e-mail-címet, jelszót, szerepkört és sofőr-hozzárendelést állíthat be;
- látja, ha valamelyik sofőr átadott egy feladatot másik autónak;
- az átadási napló megőrzi, ki, mikor és kinek adta át a rendelést.

SOFŐRÖK
- Márió, Patrik és Martin külön e-mail-címmel és jelszóval jelentkezik be;
- csak a saját, aznapi feladatait látja;
- más napot, másik sofőr teljes listáját, importot és törzsadatokat nem lát;
- egy gombbal átadhat egy feladatot a másik két sofőr egyikének;
- az átadás azonnal megjelenik az adminnál és a fogadó sofőrnél;
- hosszú szálanyag nem ponyvás autóra történő átadásakor figyelmeztetés keletkezik;
- rendeléshez szállítólevél-fotó, kézi megjegyzés, hangfelvétel és diktált szöveg csatolható;
- a jelentés teljesített állapotot is beállíthat.

BEJELENTKEZÉS
Az első admin a .env fájlban beállított:
ADMIN_EMAIL
ADMIN_PASSWORD

Az első indulás után az admin a Felhasználók menüben hozza létre:
- Márió felhasználóját, driverKey = mario
- Patrik felhasználóját, driverKey = patrik
- Martin felhasználóját, driverKey = martin

HELYI INDÍTÁS
1. Telepíts Node.js 20 vagy újabb verziót.
2. Csomagold ki a projektet.
3. Másold a .env.example fájlt .env névre.
4. Módosítsd legalább:
   JWT_SECRET
   ADMIN_EMAIL
   ADMIN_PASSWORD
5. Parancssorban a projekt mappájában:
   npm install
   npm start
6. Nyisd meg:
   http://localhost:3000

AUTOMATIKUS E-MAIL
A .env fájlban töltsd ki:
SMTP_HOST
SMTP_PORT
SMTP_SECURE
SMTP_USER
SMTP_PASS
MAIL_FROM
REPORT_TO=szabo.sandor@stand98.hu

AI HANGÁTÍRÁS
Opcionálisan:
OPENAI_API_KEY
OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe

TELEPÍTÉS INTERNETRE
A V8 NEM FUTTATHATÓ CSAK GITHUB PAGESEN, mert biztonságos:
- bejelentkezést,
- jelszókezelést,
- központi adatbázist,
- eszközök közötti szinkront,
- automatikus e-mailt
igényel.

Használható például:
- Render
- Railway
- Fly.io
- VPS
- céges szerver

A teljes projektet kell telepíteni, nem csak a public mappát.
A data/store.json futás közben automatikusan létrejön.

BIZTONSÁG
- a jelszavak bcrypt hash-ként tárolódnak;
- a bejelentkezés HTTP-only cookie-val működik;
- a sofőr API-szinten sem tud másik sofőr vagy másik nap feladataihoz hozzáférni;
- éles használatnál kötelező a HTTPS és erős JWT_SECRET.
