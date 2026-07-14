FUVAR-SZERVEZŐ V6

A V6 legfontosabb javítása
- A fuvar dátuma mindig a feltöltött Excel UTOLSÓ ELŐTTI oszlopa.
- Az utolsó előtti oszlop fejlécének pontosan „Dátum”-nak kell lennie.
- Az UTOLSÓ oszlop az „autó”.
- A program nem használ fix Excel-oszlopszámot.
- Ha a táblázat közepére új oszlopok kerülnek, az import továbbra is működik.
- Ha a két utolsó oszlop neve vagy sorrendje hibás, a program nem importál, hanem jól látható hibaüzenetet ad.

A V5 minden funkciója megmaradt
- igazságos szétosztás Márió, Patrik és Martin között;
- Vác, Kispest és Felcsút figyelembevétele;
- 7:00–16:00 munkaidő és túlóra-becslés;
- hosszú, 4–6 méteres szálanyag automatikusan Martin ponyvás autójára;
- húzással változtatható sorrend;
- rendelés áthúzása másik autóra;
- térképes útvonal;
- Excel, Word és PDF export;
- szállítólevél-fotó;
- kézi megjegyzés;
- hangfelvétel;
- hangfájl és fotók e-mailes küldése;
- opcionális szerveres automatikus e-mail és AI-hangátírás.

GITHUB FRISSÍTÉS
A repository MAIN ágában írd felül:
index.html
styles.css
app.js
data.js
manifest.webmanifest
sw.js
icon-192.png
icon-512.png

A `server` mappa is frissíthető, de GitHub Pages nem futtat szerveroldali kódot.

FRISSÍTÉS UTÁN
1. Várj 1–3 percet.
2. Számítógépen Ctrl+F5.
3. iPhone-on töröld a korábbi főképernyős appot.
4. Safariban nyisd meg az oldalt, majd Megosztás → Hozzáadás a Főképernyőhöz.
