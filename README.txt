FUVAR- ÉS ÚTVONALTERVEZŐ V35

GitHub Pages feltöltés:
1. A ZIP tartalmát csomagold ki.
2. A fájlokat a repository gyökérkönyvtárába töltsd fel.
3. GitHub Pages: Deploy from branch / main / root.
4. Feltöltés után egyszer Ctrl+F5 frissítés javasolt.

V35 fő változásai:
- A szétosztás alapegysége elsősorban a külön felrakóhely, nem a rendelésdarabszám.
- Az Autó oszlop Patrik/Márió/Martin értékei továbbra is fixek.
- A Dobozos tételek egész külső felrakóblokkokban oszlanak szét.
- Ugyanazon külső felrakó Dobozos rendelései nem szakadnak több sofőrre.
- A Központi raktár projektblokkjai terheléskiegyenlítéshez külön oszthatók.
- Martin csak valódi alulterhelésnél és alacsony hosszú/nagyterjedelmű terhelésnél kap Dobozos blokkot.
- A tételek neve és megjegyzése alapján szélesebb hosszú- és nagyterjedelműanyag-felismerés működik.
- Az optimalizálás normál esetben kizárólag a felrakók sorrendjét tervezi.
- A normál lerakók nem befolyásolják a térképet vagy a felrakási sorrendet.
- Teljes autós rakomány esetén a felrakás után kötelező azonnali lerakás marad.
- A sorrendmotor a feltöltött kézi fuvarnapokból származó történeti mintákat, a sofőrprofilokat és a közúti távolságot együtt használja.
- A rögzítő zászlók helye változatlanul elsőbbséget élvez.

A V35 tesztjei:
- Névre jelölt fuvar nem mozdul.
- Azonos külső felrakó Dobozos rendelései együtt maradnak.
- A külön felrakók száma erősebb terhelési tényező, mint a rendelésdarabszám.
- Martin, Márió és Patrik jóváhagyott példái reprodukálhatók.
- A 2026.07.22-i három kézi felrakási minta reprodukálható.
- Teljes autós felrakó után közvetlenül kötelező lerakó esemény következik.
- Normál lerakó nem kerül bele az útvonaltervbe.
