# Pastoreo Inteligente — Front-end

Front-end del proyecto **Pastoreo Inteligente**, trabajo de cuarto año (TIC) en ORT
Belgrano. El sistema ayuda a decidir, día a día, a qué lote del campo conviene llevar el
rebaño en un pastoreo rotativo de ovejas: cruza datos satelitales de vegetación por lote
con el recorrido real de collares GPS colocados en los perros de pastoreo, para confirmar
si el rebaño fue hacia el lote recomendado.

Esta carpeta (`/frontend`) contiene solo la parte de interfaz. El resto del sistema vive en
las otras carpetas de este mismo repo, a cargo del resto del equipo.

## Qué muestra la app

- **Ranking de lotes** — cada lote del campo con un puntaje de conveniencia y la razón de
  la recomendación (vegetación, agua, distancia, días de descanso).
- **Mapa satelital** — el productor dibuja el contorno de cada lote directamente sobre la
  imagen satelital.
- **Recorrido del perro** — el trayecto que registró el collar GPS, superpuesto al mapa,
  comparado contra el lote recomendado del día.
- **Historial** — jornadas anteriores: qué se recomendó y adónde fue el perro.

## Stack

| Parte | Tecnología |
|---|---|
| Framework | React + Vite |
| Lenguaje | JavaScript |
| Estilos | CSS plano |
| Mapa | [Leaflet](https://leafletjs.com/) vía `react-leaflet` |
| Capa satelital | Esri World Imagery |
| Dibujo de lotes | [`@geoman-io/leaflet-geoman-free`](https://github.com/geoman-io/leaflet-geoman) |
| Cálculos geográficos | [Turf.js](https://turfjs.org/) |
| Datos de vegetación | [Copernicus Data Space Ecosystem](https://dataspace.copernicus.eu/) (Sentinel Hub, índice NDVI) |

Se eligió Leaflet en vez de Google Maps porque no requiere tarjeta de crédito ni facturación
para funcionar, algo que Google Maps Platform exige desde 2025.

## Cómo correrlo

Requiere [Node.js](https://nodejs.org/) (versión LTS).

```bash
cd frontend
npm install
npm run dev
```

Abrir la URL que muestra la terminal (por defecto `http://localhost:5173`).

Para generar la versión de producción:

```bash
npm run build
```

## De dónde salen los datos

Por ahora, los datos de lotes, NDVI y recorridos GPS son **valores de prueba** cargados a
mano dentro del front, con la misma forma que van a tener los datos reales. El NDVI real se
pide a Sentinel Hub mandando el polígono del lote y un rango de fechas; esa consulta la hace
el backend, no el front, porque requiere una credencial que no puede quedar expuesta en el
navegador. El front solo va a consumir un número ya procesado.

## Equipo y roles

| Integrante | Rol |
|---|---|
| Antón Maciel Page | Front-end (esta carpeta) |
| Sebi Szvalb | Full-stack (backend, base de datos, hardware del collar) |
| Rocco Altieri | Inteligencia Artificial (puntaje de recomendación) |
| Manu Kaplan | UX/UI (diseño de pantallas) |

## Estado

En desarrollo. Orden de trabajo:

1. Mapa satelital en pantalla.
2. Dibujo y guardado de lotes (GeoJSON).
3. Pantalla de ranking con puntaje por fórmula fija.
4. Recorrido del perro y cruce con los lotes (punto en polígono).
