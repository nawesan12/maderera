// Las preferencias de la persona en este navegador: el tema, la densidad de
// la lista y el nombre y la firma con que sale cada casilla. Viven en
// localStorage, que puede no estar (ventana privada): todo va con try.

export type Tema = "sistema" | "claro" | "oscuro";
export type Densidad = "comoda" | "media" | "compacta";

function leer<T>(clave: string, porOmision: T): T {
  try {
    const v = localStorage.getItem(clave);
    return v === null ? porOmision : (JSON.parse(v) as T);
  } catch {
    return porOmision;
  }
}

function guardar(clave: string, valor: unknown) {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    // Sin almacenamiento: vale para esta pestaña y nada más.
  }
}

const oscuroDelSistema = matchMedia("(prefers-color-scheme: dark)");

class Preferencias {
  tema = $state<Tema>(leer("correo:tema", "sistema"));
  densidad = $state<Densidad>(leer("correo:densidad", "comoda"));
  /** Si el sistema está en oscuro: para el ícono del botón cuando el tema es «sistema». */
  sistemaOscuro = $state(oscuroDelSistema.matches);

  oscuro = $derived(this.tema === "oscuro" || (this.tema === "sistema" && this.sistemaOscuro));

  constructor() {
    oscuroDelSistema.addEventListener("change", (e) => (this.sistemaOscuro = e.matches));
    this.aplicar();
  }

  aplicar() {
    const r = document.documentElement;
    if (this.tema === "sistema") delete r.dataset.tema;
    else r.dataset.tema = this.tema;
    r.dataset.densidad = this.densidad;
  }

  ponerTema(t: Tema) {
    this.tema = t;
    guardar("correo:tema", t);
    this.aplicar();
  }

  /** El botón de la barra: pasa al tema contrario del que se ve. */
  alternarTema() {
    this.ponerTema(this.oscuro ? "claro" : "oscuro");
  }

  ponerDensidad(d: Densidad) {
    this.densidad = d;
    guardar("correo:densidad", d);
    this.aplicar();
  }

  remitente(casilla: string): { nombre: string; firma: string } {
    return { nombre: "", firma: "", ...leer(`correo:ajustes:${casilla.toLowerCase()}`, {}) };
  }

  guardarRemitente(casilla: string, datos: { nombre: string; firma: string }) {
    guardar(`correo:ajustes:${casilla.toLowerCase()}`, { nombre: datos.nombre.trim(), firma: datos.firma.trim() });
  }
}

export const preferencias = new Preferencias();
