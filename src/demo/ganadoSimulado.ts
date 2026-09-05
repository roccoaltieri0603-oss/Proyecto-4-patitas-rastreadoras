import { useSyncExternalStore } from "react";

/**
 * En qué lote está parado el punto de GPS simulado del mapa.
 *
 * Vive en memoria del módulo a propósito: al recargar la página se pierde,
 * igual que la posición del punto arrastrable de `GpsSimulado`. No es un dato
 * de ganado real —GPS y dispositivos siguen pausados en CLAUDE.md—, no viaja
 * al backend y no se guarda en ningún lado. Lo único que hace es habilitar las
 * herramientas de demo de la ficha, que necesitan saber si en la presentación
 * "hay animales adentro" de ese lote.
 *
 * Es un módulo suelto y no un contexto de React porque el mapa y la ficha son
 * dos rutas distintas: cuando se navega a `/lotes/:id`, el mapa se desmonta.
 */
let loteConGanado: string | null = null;
const suscriptores = new Set<() => void>();

export function marcarGanadoEn(loteId: string | null): void {
  if (loteId === loteConGanado) return;
  loteConGanado = loteId;
  suscriptores.forEach((avisar) => avisar());
}

function suscribir(avisar: () => void): () => void {
  suscriptores.add(avisar);
  return () => { suscriptores.delete(avisar); };
}

export function useLoteConGanado(): string | null {
  return useSyncExternalStore(suscribir, () => loteConGanado);
}
