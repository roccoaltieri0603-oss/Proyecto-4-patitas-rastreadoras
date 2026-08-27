Solo archivos estáticos: imágenes, íconos `.svg`, fuentes.
Nada de `.tsx` acá — los componentes van en `src/components/`.

## Qué hay

- `campo.jpg` — la foto de campo del Figma; fondo a sangre de las pantallas de
  acceso (`src/components/ui/CampoBackdrop.tsx`).
- `rodeo-logo.svg` — el wordmark RODEO completo, las cinco fichas
  (`src/components/ui/RodeoLogo.tsx`).
- `rodeo-marca.svg` — sólo la ficha de la `R`, para usos chicos: encabezados,
  pantallas de carga, favicon.

## De dónde salieron

Los tres estaban en el repo del prototipo (`bs2896-stack/RODEO-prototipo-1`)
como `cow.jpeg`, `Rodeo Layout.svg` y `R.svg`, exportados del Figma en su
momento. Se trajeron tal cual al unificar los repos, así que son los originales
del diseño y no hace falta volver a exportarlos.

Los hex de la marca (`--color-lima`, `--color-crema` en `src/index.css`) están
tomados de `rodeo-logo.svg`: `#79DA58` para la ficha y `#FFDE67` para la letra.
