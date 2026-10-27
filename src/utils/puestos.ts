import type { Rol } from "../../backend/src/autorizacion/catalogo";

export function referenciaPuesto(id: string): string {
  return id.slice(0, 8).toLocaleUpperCase('en-US');
}

/** El rol como se lee, no como se guarda: "Propietario", no "PROPIETARIO". */
export function etiquetaRol(rol: Rol): string {
  return rol === 'PROPIETARIO' ? 'Propietario' : rol === 'ADMINISTRADOR' ? 'Administrador' : 'Visor';
}
