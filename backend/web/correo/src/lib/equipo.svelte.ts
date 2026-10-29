// La casilla compartida (backend/internal/correo/equipo.go): quién tiene
// cada conversación, en qué estado está, las notas internas, los
// seguimientos y las respuestas guardadas. Solo si la sesión dice `equipo`.

import { api, type DatosHilo, type EstadoHilo, type Persona, type Plantilla, type Seguimiento } from "./api";
import { bandeja } from "./estado.svelte";
import { sesion } from "./sesion.svelte";

export const nombresEstado: Record<EstadoHilo["estado"], string> = {
  nuevo: "Nuevo",
  "en-curso": "En curso",
  esperando: "Esperando al cliente",
  resuelto: "Resuelto",
};
export const familiaEstado: Record<EstadoHilo["estado"], string> = {
  nuevo: "ce",
  "en-curso": "mar",
  esperando: "esp",
  resuelto: "ok",
};

class Equipo {
  personas = $state<Persona[]>([]);
  /** Quién está sentado en este navegador (en una casilla compartida). */
  yo = $state("");
  hilos = $state<Record<string, EstadoHilo>>({});
  seguimientos = $state<Seguimiento[]>([]);
  plantillas = $state<Plantilla[]>([]);
  #cargado = false;

  get activo() {
    return sesion.equipo;
  }

  #clave() {
    return `correo:yo:${(bandeja.correo ?? "").toLowerCase()}`;
  }

  async iniciar() {
    if (!sesion.equipo || this.#cargado) return;
    this.#cargado = true;
    try {
      const e = await api.equipo();
      this.personas = e.personas;
      let guardado = "";
      try {
        guardado = localStorage.getItem(this.#clave()) ?? "";
      } catch {
        // sin almacenamiento
      }
      this.yo = e.personas.some((p) => p.id === guardado) ? guardado : (e.dueno ?? "");
    } catch {
      this.#cargado = false;
    }
    void this.cargarSeguimientos();
    void this.cargarPlantillas();
  }

  elegirYo(id: string) {
    this.yo = id;
    try {
      localStorage.setItem(this.#clave(), id);
    } catch {
      // vale para esta pestaña
    }
  }

  nombreDe(id: string): string {
    return this.personas.find((p) => p.id === id)?.nombre ?? "";
  }

  /** Trae el estado de las conversaciones de la página. */
  async conocer(hilos: (string | undefined)[]) {
    if (!sesion.equipo) return;
    const lista = [...new Set(hilos.filter((h): h is string => !!h))];
    if (!lista.length) return;
    try {
      const r = await api.hilos(lista);
      this.hilos = { ...this.hilos, ...r };
    } catch {
      // sin panel: la lista sigue sin estados
    }
  }

  async guardar(d: DatosHilo & { estado?: EstadoHilo["estado"]; asignadoA?: string; soltar?: boolean }) {
    const antes = this.hilos[d.hilo];
    // Al instante en la pantalla; si falla, vuelve.
    this.hilos = {
      ...this.hilos,
      [d.hilo]: {
        hilo: d.hilo,
        estado: d.estado ?? antes?.estado ?? "nuevo",
        asignadoA: d.soltar ? "" : (d.asignadoA ?? antes?.asignadoA ?? ""),
        asignadoNombre: d.soltar ? "" : d.asignadoA ? this.nombreDe(d.asignadoA) : (antes?.asignadoNombre ?? ""),
        notas: antes?.notas ?? 0,
      },
    };
    try {
      const r = await api.guardarHilo(d);
      this.hilos = { ...this.hilos, [d.hilo]: r };
    } catch (e) {
      this.hilos = antes ? { ...this.hilos, [d.hilo]: antes } : this.hilos;
      bandeja.avisar(e instanceof Error ? e.message : "No se pudo guardar.", undefined, true);
    }
  }

  async cargarSeguimientos() {
    if (!sesion.equipo) return;
    try {
      this.seguimientos = await api.seguimientos();
    } catch {
      // sin panel o sin IMAP: sin avisos
    }
  }

  async cancelarSeguimiento(id: string) {
    this.seguimientos = this.seguimientos.filter((s) => s.id !== id);
    try {
      await api.cancelarSeguimiento(id);
    } catch {
      void this.cargarSeguimientos();
    }
  }

  async cargarPlantillas() {
    if (!sesion.equipo) return;
    try {
      this.plantillas = await api.plantillas();
    } catch {
      // sin panel: sin respuestas guardadas
    }
  }
}

export const equipo = new Equipo();
