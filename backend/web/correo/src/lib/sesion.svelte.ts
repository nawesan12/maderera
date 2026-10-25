// Lo que el servidor dice de la sesión además de la casilla: a dónde vuelve
// «Volver al panel» y si esta casilla puede ver las fichas de clientes del
// ERP (solo las de staff admin o vendedor, y solo si la base responde).

export interface DatosSesion {
  correo: string;
  /** La dirección del panel, si está configurada (CORREO_PANEL). */
  panel?: string;
  /** Si la casilla es de staff con permiso para ver clientes. */
  fichas?: boolean;
}

class Sesion {
  panel = $state("");
  fichas = $state(false);

  tomar(d: DatosSesion) {
    this.panel = d.panel ?? "";
    this.fichas = !!d.fichas;
  }
}

export const sesion = new Sesion();
