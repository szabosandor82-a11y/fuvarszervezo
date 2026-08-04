Fuvarszervező V38 – GitHub Pages csomag
======================================

Feltöltés:
1. A ZIP teljes tartalmát másold a GitHub Pages tároló gyökérkönyvtárába.
2. A korábbi fájlokat cseréld le.
3. Feltöltés után használj Ctrl+F5 frissítést, telefonon zárd be és nyisd meg újra az oldalt.

V38 fő újdonságok:
- Új „Outlook import” oldal két külön behúzómezővel:
  - Dobozos import
  - Martin / Platós import
- Egy importmezőbe egyszerre több Outlook .msg fájl húzható be.
- Teszteléshez közvetlen PDF feltöltés is engedélyezett.
- A program együtt elemzi a levél tárgyát, szövegét és a csatolt PDF-eket.
- A PDF felső részén lévő SERPA rendelésazonosítóból csak a „/” utáni rész kerül be.
  Példa: 2025-SR0/003141 → 003141.
- A felrakót és a projektet a törzsadatokhoz illeszti, a címeket onnan egészíti ki.
- A projekt címét a Projekt törzsadatból használja; a PDF-en szereplő vevői címet nem tekinti automatikusan lerakónak.
- Kiegészítő helymegjelöléseket össze tud kapcsolni, például „Fogarasi” + „Hunyadi”.
- A Dobozos import Autó kategóriája „Dobozos”, és később a Fuvarok szétosztása osztja el.
- A Martin / Platós import közvetlenül Martinra kerül, és nem osztható át.
- Import előtt szerkeszthető előnézet, figyelmeztetések és duplikált rendelésszám-ellenőrzés jelenik meg.
- A tételeket a PDF táblázatából is megpróbálja kinyerni, a hosszú/szálas anyagokat jelöli.
- Megmaradt a V37 összes nézet-, csoportosítási, útvonal-, hátralék- és térképfunkciója.

Minták alapján ellenőrizve:
- Larex / Budapest_M76 / 003141
- Szatmári Késmárk / Budapest_Kincsem_K6 / 004911

Technikai megjegyzés:
- Az Outlook .msg feldolgozó és a PDF-olvasó külső böngészős modulból töltődik be, ezért az első használatkor internetkapcsolat szükséges.

Teszt:
- TEST_V38.js: 11/11 sikeres.
- V33, V34, V35 és V37 kompatibilitási tesztek: 39/39 sikeres.
- Összes automatikus szabályteszt: 50/50 sikeres.
