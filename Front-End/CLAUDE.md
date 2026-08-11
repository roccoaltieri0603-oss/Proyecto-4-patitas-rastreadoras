# Contexto de /Front-End — Pastoreo Inteligente

## Quién trabaja acá

Antón Francisco Maciel Page, estudiante de 4º año de TIC en ORT Belgrano. Español argentino.
No se considera programador: está cómodo con JavaScript, HTML, CSS y Python, nada más allá de eso.

Cómo explicarle el código: en prosa, no en listas de bullets (las listas solo para pasos u opciones).
Nivel principiante-intermedio, sin asumir conocimiento previo de librerías ni de patrones. La idea es
que él pueda escribir y entender el código él mismo, no que se lo entreguen hecho. Preguntar antes de
asumir cosas.

Esta carpeta `/Front-End` la usa además para su materia de front-end avanzado, aunque el repo es del
equipo entero.

## Qué es el proyecto

"Pastoreo Inteligente" es un sistema para manejar pastoreo rotativo de ovejas. La idea: combinar datos
satelitales de cada lote de campo (para saber cuánto pasto hay y cuál conviene pastorear) con collares
GPS puestos en los perros pastores, que sirven para confirmar si el rebaño efectivamente fue al lote
que el sistema recomendó.

Es un proyecto de equipo de cuarto año. El repo tiene también una carpeta `Back-End`, que es de los
compañeros.

## Stack elegido para el front

React con Vite, en JavaScript plano (no TypeScript). Los estilos van en CSS común, sin Tailwind ni
librerías de componentes.

Para el mapa se usa Leaflet en lugar de Google Maps, con `react-leaflet` como envoltorio de React. La
capa satelital de fondo es Esri World Imagery, que es gratuita y no pide clave de API.

Para dibujar los lotes del campo como polígonos sobre el mapa se usa Leaflet-Geoman
(`@geoman-io/leaflet-geoman-free`), que agrega las herramientas de dibujo y edición encima de Leaflet.

Para las cuentas geográficas (área de un lote en hectáreas, centroide, si un punto GPS cae adentro de
un polígono, distancias) se usa Turf.js (`@turf/turf`), que trabaja con GeoJSON.

Los datos satelitales de vegetación van a venir de Copernicus / Sentinel Hub, pero más adelante y
siempre a través del backend. La clave de Sentinel Hub nunca va en el front: cualquier cosa que se
escriba en el código de React viaja al navegador del usuario y queda expuesta. El front le pide los
datos al backend, y el backend es el que habla con Sentinel Hub usando la clave.

## Estado actual

Proyecto base de Vite + React recién creado, con las dependencias del mapa ya instaladas. Todavía no
hay código de funcionalidades: el mapa no está implementado.
