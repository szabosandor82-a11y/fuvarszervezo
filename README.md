# Fuvarszervező V13

GitHub Pages-en is futtatható, telepítés nélküli webalkalmazás.

## V13 funkciók

- SERPA Excel/CSV import.
- Beszállító: mindig az `Ügyfél/raktár név` oszlopból.
- Felrakó címe: mindig a kapcsolódó `Szállítási cím` oszlopból.
- Projekt: mindig a `Témaszám név` oszlopból.
- Lerakó cím: a Projektek törzsadatból.
- Bizonytalan lerakó cím: piros importellenőrzés.
- Projekt- és beszállítóválasztásnál automatikus címkitöltés, kézzel módosítható mezőkkel.
- Projektek, beszállítók és átvevők importálható Excel-sablonokkal.
- Autók hozzáadása, szerkesztése és törlése.
- Helyi adatmentés a böngészőben.
- Rendelések Excel-exportja.

## Használat

Nyisd meg az `index.html` fájlt, vagy töltsd fel a teljes mappát GitHubra és kapcsold be a GitHub Pages szolgáltatást.

## Megjegyzés

A program a SheetJS CDN-t használja Excel-fájlok olvasásához és írásához, ezért az Excel import/export internetkapcsolatot igényel.
