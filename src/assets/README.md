Solo archivos estáticos: imágenes, íconos `.svg`, fuentes.
Nada de `.tsx` acá — los componentes van en `src/components/`.

## Qué hay

- `campo.jpg` — la foto de campo del Figma; fondo a sangre de las pantallas de
  acceso (`src/components/ui/CampoBackdrop.tsx`).
- `rodeo-logo.svg` — el wordmark RODEO completo, las cinco fichas
  (`src/components/ui/RodeoLogo.tsx`).
- `rodeo-marca.svg` — sólo la ficha de la `R`, para usos chicos: encabezados,
  pantallas de carga, favicon.
- `ingreso-vaca.jpg` — la foto de la columna izquierda del frame "login" del
  Figma (`src/pages/PantallaIngreso.tsx`): el original de Pexels
  (foto 28957470, de Aizhan A., licencia Pexels) reducido de 2272×4032 a
  1600 px de ancho. No reemplazarla por una exportación del Figma a 1x: sale a
  502×832 y se pixela en cualquier pantalla más grande que el frame.
- `establecimientos-fondo.jpg` — fondo de Mis establecimientos
  (`src/pages/PantallaMisEstablecimientos.tsx`): el original de Pexels
  (foto 18164899, de Tuba Karabulut, licencia Pexels) a 3000×2000.
- `carga-rodeo.jpg` — la pantalla de carga del Figma, con el wordmark ya dentro
  de la imagen (`src/components/ui/FondoCarga.tsx`). Reducida de 3840×2160 a
  2560×1440 para que no pese 10 MB.

## De dónde salieron

Los tres estaban en el repo del prototipo (`bs2896-stack/RODEO-prototipo-1`)
como `cow.jpeg`, `Rodeo Layout.svg` y `R.svg`, exportados del Figma en su
momento. Se trajeron tal cual al unificar los repos, así que son los originales
del diseño y no hace falta volver a exportarlos.

Los hex de la marca (`--color-lima`, `--color-crema` en `src/index.css`) están
tomados de `rodeo-logo.svg`: `#79DA58` para la ficha y `#FFDE67` para la letra.
