Solo archivos estáticos: imágenes, íconos `.svg`, fuentes.
Nada de `.tsx` acá — los componentes van en `src/components/`.

## Pendiente: la foto de campo del diseño

Las pantallas de acceso (bienvenida, iniciar sesión y crear cuenta) usan de
fondo una foto de campo que está en el Figma pero todavía no en el repo.

Para ponerla:

1. Exportala del Figma como `campo.jpg` y guardala en esta carpeta.
2. En `src/components/ui/CampoBackdrop.tsx`, importala y pasala a
   `backgroundImage`. El componente ya está preparado: mientras el archivo no
   exista dibuja un degradado con los mismos tonos.

## Pendiente: el logo RODEO

En `src/components/ui/RodeoLogo.tsx` las letras están armadas con CSS, imitando
las del diseño. Los originales son cinco SVG en el Figma (`R`, `O`, `D`, `E`,
`O`). Si se exportan a esta carpeta, conviene reemplazar el CSS por los SVG
reales.
