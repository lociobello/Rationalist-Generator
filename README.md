# Rationalist Utopia — web

## generator/ — Rationalist Building Generator

Generatore procedurale di edifici dell'architettura razionalista italiana (1928–1942), in three.js. Gira nel browser senza passaggi di build: HTML, CSS e moduli JavaScript. three.js (0.186.1) e i font arrivano da CDN (jsDelivr, Google Fonts).

L'interfaccia segue il layout disegnato da Lorenzo: bianco e nero, un solo carattere geometrico (Jost, vicino al Futura), riquadri a filo nero. In alto il cartellino (Rationalist Utopia, numero progressivo e nome dell'edificio, in inglese), il titolo "Rationalist Generator" e il pulsante **Download** (fotografie 1:1, 4:5, 3:2 e modello 3D). In basso le inquadrature (Frontal, Free, Low, Aerial), **Generate** (anche col tasto G) e le stampe (Archival, Postcard, Color, Technical); la voce attiva è piena nera con scritta bianca. Ogni Generate produce un edificio casuale, con tipologia, seme, luce, nuvole e grado di invecchiamento propri, numerato 001, 002, … nella sessione. Sugli edifici non compare nessuna scritta. I parametri sono tutti nel codice (`js/presets.js`) e l'indirizzo della pagina (`/generator/#RU1.…`) riproduce l'edificio che stai guardando.

### Aprirlo in locale

I moduli ES non partono da `file://`, serve un piccolo server:

```
cd "02 WEB"
python3 -m http.server 8000
```

poi apri http://localhost:8000/generator/

### Metterlo online (GitHub Pages)

La radice (`index.html`) per ora apre direttamente il generatore; quando ci sarà l'archivio prenderà il suo posto. `.gitignore` tiene fuori i file `.DS_Store` del Mac.

Con GitHub Desktop (consigliato, gli aggiornamenti diventano due clic):

1. GitHub Desktop → File → Add Local Repository → scegli questa cartella `02 WEB` → "create a repository" → Create Repository.
2. Publish repository: nome `rationalist-utopia`, togli la spunta a "Keep this code private" (GitHub Pages gratuito richiede un repository pubblico).
3. Su github.com, nel repository: Settings → Pages → Build and deployment → Source "Deploy from a branch", Branch `main`, cartella `/ (root)` → Save.
4. Dopo un minuto o due il sito è su `https://<utente>.github.io/rationalist-utopia/` e il generatore su `/generator/`.

Per aggiornare: GitHub Desktop mostra i file cambiati → scrivi una riga di descrizione → Commit to main → Push origin.

Dominio personalizzato (facoltativo): Settings → Pages → Custom domain, per esempio `rationalistutopia.lorenzo-bernini.com`; poi nel DNS del dominio un record CNAME che punta a `<utente>.github.io`, e infine la spunta su "Enforce HTTPS".

Limiti di GitHub Pages: sito fino a 1 GB, circa 100 GB di traffico al mese (limite indicativo), repository pubblico sul piano gratuito.

### Come funziona

La pianta è una griglia di campate (interasse 3–6 m). Ogni cella ha un numero di piani; ogni faccia esposta, piano per piano, riceve un modulo di facciata:

| Modulo | Riferimento |
|---|---|
| Finestre strombate | Palazzi degli uffici, Palazzo di Giustizia di Milano |
| Lesene continue | Città universitaria di Roma, Palazzo delle Poste di Napoli |
| Finestre a nastro | Colonie marine, Poste di Pola |
| Telaio a griglia | Casa del Fascio di Como (Terragni) |
| Colonnato gigante | Palazzo dei Congressi / dei Ricevimenti all'E42 |
| Muro cieco con feritoia in vetrocemento | fianchi, torri, testate |

Poi si aggiungono gli elementi: pronao con pilastri giganti e architrave, portico su pilastri, loggia all'ultimo piano, torre (feritoia e orologio, belvedere ad archi, finestrata, faro, spirale da colonia), arengario, pensilina, sala voltata, basamento con scalinata, zoccolo in pietra. Pini, cipressi, figure in cappotto, lampioni e pennoni danno la scala.

Le sette tipologie (Palazzo del Governo, Poste, Stazione, Università, Colonia marina, Blocco a telaio, Palazzo dei Congressi) sono distribuzioni di probabilità sui parametri, in `js/presets.js`. Per aggiungerne una: una nuova voce in `TYPOLOGIES`, un `case` in `generate()`, i nomi in `NAMES` e le etichette in `js/i18n.js`.

### Materiali

Tutte le superfici sono dipinte proceduralmente all'avvio (`js/materials.js`): colore, rilievo (normal map) e ruvidità per travertino a lastre con vene e pori allungati, marmo levigato con venature, intonaco bianco e ocra, mattone con fughe arretrate, peperino bugnato per zoccoli e basamenti, lastricato della piazza. Nel browser la pietra riceve anche un invecchiamento calcolato sulla posizione nel mondo, quindi senza ripetizioni: variazioni di tono su grande scala, colature di pioggia lungo le pareti, sporco alla base e sui piani orizzontali. Ogni edificio ha una sua età. Il vetro è leggermente fuori piano da una finestra all'altra, come il vetro tirato dell'epoca, e alcune finestre hanno le tende tirate.

### Fotografia

La camera di stampa (`js/film.js`) lavora dopo il tone mapping:

- **Archivio**: pellicola pancromatica con filtro rosso (scurisce il cielo e schiarisce il travertino), curva di contrasto, grana, vignettatura, polvere.
- **Cartolina**: colore sbiadito su carta ingiallita.
- **Colore** e **Disegno** (linee su carta, per tavole e assonometrie).

Il **decentramento** tiene la camera in bolla e sposta il piano immagine, come un banco ottico: le verticali restano parallele.

### Esportazioni

- **Fotografia 1:1 / 4:5 / 3:2**: PNG fino a 2400 px impaginato come un cartoncino bianco: la foto con un margine bianco uniforme e, sotto, nome dell'edificio e numero a sinistra, RATIONALIST UTOPIA a destra (Jost bold, spaziato). Se la vista è quella preimpostata, l'inquadratura si ricalcola sulle proporzioni della stampa; se hai ruotato la camera, resta la tua.
- **Modello 3D (.glb)**: una mesh per materiale (Travertine, Glass, Frames…) con colore, normal map e ruvidità; metri, asse Y in alto. In Blender: File → Import → glTF 2.0. L'invecchiamento dipende dallo shader del browser e non viaggia nel file.

### File

```
generator/
  index.html
  css/style.css
  js/main.js       scena, luce, camera, stampa, export
  js/building.js   grammatica: pianta, moduli di facciata, pronao, torre…
  js/site.js       alberi, figure, lampioni, pennoni, stele
  js/presets.js    tipologie, nomi, città immaginarie
  js/materials.js  materiali procedurali e invecchiamento
  js/sky.js        cielo con nuvole
  js/film.js       camera oscura
  js/geo.js        accumulatore di geometria con UV in metri
  js/ui.js         interfaccia: Generate, inquadrature, stampe, Download
  js/i18n.js, js/io.js, js/rng.js
```
