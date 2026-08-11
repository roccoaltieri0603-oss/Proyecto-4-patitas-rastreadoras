# Front-End — Pastoreo Inteligente

Interfaz web del sistema de pastoreo rotativo: mapa de los lotes del campo con capa
satelital, dibujo de los polígonos de cada lote y seguimiento de los collares GPS.

Stack: React + Vite (JavaScript), CSS plano, Leaflet para el mapa (capa satelital Esri
World Imagery), Leaflet-Geoman para dibujar los lotes y Turf.js para las cuentas
geográficas.

## Correrlo

```
npm install
npm run dev
```

Abre en `http://localhost:5173`. Para verificar que compila: `npm run build`.

El contexto largo del proyecto (qué es, cómo está pensado el stack, por qué Leaflet y no
Google Maps) está en `CLAUDE.md`.
