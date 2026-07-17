FUVAR-SZERVEZŐ V15 – GITHUB PAGES VERZIÓ

A V12/V14 működésére épülő javított verzió.

V15 javítások:
- A SERPA-import a fuvar dátumát mindig a tényleges „Dátum” oszlopból olvassa ki.
- Csak az érvényes dátummal rendelkező sorokat importálja; üres dátumú sorokkal nem foglalkozik.
- A program kezeli az Excel-dátumokat, valamint az ÉÉÉÉ.HH.NN és NN.HH.ÉÉÉÉ formátumokat.
- A dátumok helyi idő szerint kerülnek mentésre, így nem csúsznak át másik napra.
- A hiányos importált fuvar akkor is bekerül, ha az ellenőrzésnél továbblépnek.
- Ha a jármű nincs megadva, a fuvar automatikusan Márió autójára kerül.
- A jármű és minden más fuvaradat később a Szerkesztés gombbal módosítható.
- A Martin-jelölés és a hosszú szálanyag szabály továbbra is elsőbbséget élvez.
- Az import után nincs automatikus újraosztás, ezért a kiválasztott vagy Márióhoz rendelt jármű nem változik meg.
- A V14 törzsadat- és SERPA-import szabályai változatlanul megmaradtak.
