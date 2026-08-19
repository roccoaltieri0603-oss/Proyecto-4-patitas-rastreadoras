# RODEO

Front de gestión de establecimiento y lotes para ganadería (React + Vite +
TS), con condición de pastoreo satelital y clima por lote. Proyecto grupal:
este repo es sólo el front — GPS y backend los arma el resto del equipo.

**Leé `README.md` antes de tocar nada** — tiene la arquitectura completa,
por qué se eligió cada fuente de datos, qué se evaluó y se descartó (para no
reinvestigarlo), y los bloqueos de roadmap. Esto de acá es sólo lo que no
puede esperar a que lo leas.

## La regla que no se rompe

Nunca mostrar un dato inventado. Si no hay dato real, es "sin datos" — no un
número fabricado para rellenar un hueco. El radar (Sentinel-1) nunca se
mezcla con la óptica en el mismo puntaje: son físicas distintas sin
calibración cruzada. Los rangos de `scoring.ts` e `interpretacion.ts` son
puntos de partida, no calibración agronómica — no lo digas de otra forma.

## No construir todavía (ver README § Roadmap y bloqueos)

- **Ganado/GPS** — pausado hasta que el equipo tenga el dispositivo.
- **Rotación de pastoreo / ML** — depende de lo anterior; sin datos
  etiquetados no hay con qué entrenar nada.
- **Backend/persistencia propia** — lo hace el equipo de backend; no armar
  uno ad-hoc acá mientras tanto.
- **Alertas programadas** — sin backend no hay dónde correrlas.

Si una tarea pide alguno de estos, primero confirmá con el usuario si ya se
destrabó, no lo dés por sentado.

## Entorno

Sin herramienta de automatización de navegador acá — no se pueden tomar
capturas reales de la UI. Validar con `npx tsc --noEmit`, `npm run build`, y
scripts puntuales contra las APIs reales (Copernicus, Open-Meteo) en vez de
asumir que algo "debería" funcionar.
