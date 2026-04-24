# Il Gazzettino

Una piccola web app statica che legge il feed RSS del **Corriere** e lo presenta con un layout da quotidiano cartaceo.

## Avvio rapido

Apri `index.html` direttamente nel browser oppure servi la cartella con un server statico locale.

Esempi:

```bash
python3 -m http.server 4173
```

Poi visita `http://localhost:4173`.

## File principali

- `index.html`: struttura della pagina.
- `styles.css`: impaginazione editoriale e responsive.
- `app.js`: fetch del feed RSS, parsing XML e rendering degli articoli.

## Note tecniche

- Il feed letto e `https://xml2.corriereobjects.it/feed-hp/homepage-restyle-2025.xml`.
- Per aggirare i limiti CORS del browser, il client prova piu proxy pubblici in sequenza.
- Se un proxy non risponde o restituisce XML non valido, l'interfaccia mostra uno stato di errore leggibile.

## Limiti

La disponibilita del feed dipende sia dal feed sorgente sia dai proxy usati lato client. Se vuoi una versione piu affidabile, il passo successivo naturale e spostare il fetch del feed su un piccolo backend o edge function.
