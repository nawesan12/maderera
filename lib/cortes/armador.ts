/**
 * La lógica del armador de cortes del sitio (`app/(public)/corte/vista.tsx`)
 * que no es pantalla: los grupos de placa, el borrador del navegador, la
 * lista pegada, el nombre de cada tapacanto y el mensaje de WhatsApp. Va
 * aparte para poder probarla sin navegador (tests/armador-de-corte.test.ts).
 */
import type { LadosConCanto } from "@/components/cortes/selector-canto";
import type { Esquemas } from "@/lib/api/tipos";
import type { Mitad } from "@/lib/cortes/placa";
import type { PiezaDelEnlace } from "@/lib/cortes/enlace";

export type Tapacanto = Esquemas["Tapacanto"];

export interface Fila {
  /** «Lateral», «Estante»: viaja al plano y al mensaje, para que el taller rotule. */
  nombre: string;
  largo: string;
  ancho: string;
  cantidad: string;
  veta: boolean;
  lados: LadosConCanto;
}

const SIN_LADOS: LadosConCanto = { arriba: false, abajo: false, izquierda: false, derecha: false };

export const filaVacia = (): Fila => ({ nombre: "", largo: "", ancho: "", cantidad: "1", veta: false, lados: SIN_LADOS });

/**
 * Una placa del pedido con sus piezas. Un mueble mezcla placas —melamina de
 * 18 para el cuerpo y un fondo de 3 mm— y cada una tiene su plano, su cuenta
 * y su tapacanto (revisión de un carpintero, 18/11/2026).
 */
export interface GrupoDelArmador {
  /** Para la `key` de React: el índice cambia al sacar un grupo del medio. */
  clave: string;
  variantId: string;
  mitad: Mitad;
  /** Lo que viaja: el nombre del tapacanto elegido o lo que se escribió. */
  canto: string;
  /** La variante del catálogo elegida; null es texto libre o ninguno. */
  cantoId: string | null;
  modo: "piezas" | "tiras";
  filas: Fila[];
  tiras: { ancho: string; metros: string; lados: LadosConCanto };
}

// Un contador y no la hora: el primer grupo se arma en el prerender de
// /corte, y leer la hora ahí lo rompe. La clave no llega al HTML, así que no
// importa que el servidor y el navegador cuenten distinto.
let contador = 0;
const claveNueva = () => `g${(contador++).toString(36)}`;

export function grupoNuevo(variantId: string, filas: Fila[] = [filaVacia()]): GrupoDelArmador {
  return {
    clave: claveNueva(),
    variantId,
    mitad: null,
    canto: "",
    cantoId: null,
    modo: "piezas",
    filas,
    tiras: { ancho: "", metros: "", lados: SIN_LADOS },
  };
}

/** Las filas que arma un enlace del asistente, con su canto y su veta. */
export function filasDelEnlace(piezas: PiezaDelEnlace[]): Fila[] {
  return piezas.map((p) => ({
    nombre: "",
    largo: String(p.largo),
    ancho: String(p.ancho),
    cantidad: String(p.cantidad),
    veta: p.veta,
    lados: { arriba: p.cantoLargo >= 1, abajo: p.cantoLargo >= 2, izquierda: p.cantoAncho >= 1, derecha: p.cantoAncho >= 2 },
  }));
}

const conMedidas = (filas: Fila[]) => filas.filter((f) => f.largo && f.ancho);

/**
 * El borrador que queda en el navegador. Hasta el 18/11 era una sola placa
 * (`{ variantId, canto, filas }`); ese formato se sigue leyendo como un grupo,
 * para no perder el despiece de quien lo dejó a medias antes del cambio.
 */
export interface Borrador {
  grupos: GrupoDelArmador[];
}

export function leerBorrador(crudo: string | null): Borrador | null {
  if (!crudo) return null;
  try {
    const b = JSON.parse(crudo) as Partial<Borrador> & { variantId?: string; canto?: string; filas?: Fila[] };
    const grupos: Partial<GrupoDelArmador>[] = Array.isArray(b.grupos)
      ? b.grupos
      : Array.isArray(b.filas)
        ? [{ variantId: b.variantId ?? "", canto: b.canto ?? "", filas: b.filas }]
        : [];
    const sanos = grupos
      .filter((g) => Array.isArray(g.filas))
      .map((g) => ({
        ...grupoNuevo(g.variantId ?? ""),
        mitad: g.mitad === "largo" || g.mitad === "ancho" ? g.mitad : null,
        canto: typeof g.canto === "string" ? g.canto : "",
        cantoId: typeof g.cantoId === "string" ? g.cantoId : null,
        filas: g.filas!.map((f) => ({ ...filaVacia(), ...f })),
      }));
    return sanos.some((g) => conMedidas(g.filas).length > 0) ? { grupos: sanos } : null;
  } catch {
    return null;
  }
}

/** Cuántas medidas cargadas tiene un borrador, para ofrecer retomarlo. */
export function medidasDelBorrador(b: Borrador): number {
  return b.grupos.reduce((n, g) => n + conMedidas(g.filas).length, 0);
}

/**
 * Una lista pegada desde una planilla o un programa de despiece: un renglón
 * por pieza, con largo, ancho y cantidad en ese orden (la cantidad, si falta,
 * es 1). Un texto adelante es el nombre de la pieza. Devuelve null si lo
 * pegado no parece una lista, y entonces el pegado sigue de largo.
 */
export function leerListaPegada(texto: string): Fila[] | null {
  const renglones = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (renglones.length < 2 && !/\t/.test(texto)) return null;
  const filas: Fila[] = [];
  for (const renglon of renglones) {
    const numeros = renglon.match(/\d+(?:[.,]\d+)?/g) ?? [];
    if (numeros.length < 2) continue;
    const primero = renglon.search(/\d/);
    const nombre = renglon.slice(0, primero).replace(/[\t;:,|-]+$/, "").trim();
    const [largo, ancho, cantidad = "1"] = numeros.map((n) => String(Math.round(Number(n.replace(",", ".")))));
    filas.push({ ...filaVacia(), nombre, largo, ancho, cantidad });
  }
  return filas.length > 0 ? filas : null;
}

const plano = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** «0,45 mm», «2 mm». */
export function espesorEscrito(mm: number): string {
  return `${String(mm).replace(".", ",")} mm`;
}

/**
 * Cómo se nombra un tapacanto en el desplegable y en el pedido: la
 * descripción del catálogo y, si no los dice ya, el tipo y el espesor. Con
 * el espesor a la vista no se confunde el de 0,45 con el de 2 mm, que es lo
 * que más se equivoca al pedir por teléfono.
 */
export function nombreDelTapacanto(t: Pick<Tapacanto, "descripcion" | "tipo" | "espesorMm">): string {
  const desc = plano(t.descripcion);
  const extras: string[] = [];
  if (t.tipo && !desc.includes(plano(t.tipo).slice(0, 5))) extras.push(t.tipo);
  if (t.espesorMm != null) {
    // Un decimal suelto («0,45») ya es el espesor; un entero, solo con «mm»
    // detrás (un «2» suelto puede ser cualquier cosa).
    const mm = t.espesorMm;
    const dicho = Number.isInteger(mm)
      ? new RegExp(`(^|[^\\d.,])${mm}\\s*mm`).test(desc)
      : new RegExp(`(^|[^\\d.,])${String(mm).replace(".", "[.,]")}(?!\\d)`).test(desc);
    if (!dicho) extras.push(espesorEscrito(mm));
  }
  return extras.length ? `${t.descripcion} · ${extras.join(" · ")}` : t.descripcion;
}

/** Una pieza como la pide la API: lo que sale de las filas o de las tiras. */
export interface PiezaDelPedido {
  largoMm: number;
  anchoMm: number;
  cantidad: number;
  respetaVeta: number;
  cantoLargo: number;
  cantoAncho: number;
  etiqueta: string | null;
}

/** Un grupo listo para el mensaje: la placa ya con nombre. */
export interface GrupoDelMensaje {
  placa: string;
  mitad: Mitad;
  canto: string;
  piezas: PiezaDelPedido[];
}

/**
 * El pedido del corte, escrito para WhatsApp como lo anota quien atiende:
 * cada placa con sus medidas y su canto, y al final el enlace al plano. Con
 * una sola placa queda igual que antes de los grupos.
 */
export function textoDelPedido(grupos: GrupoDelMensaje[], enlace: string): string {
  const lados = (p: PiezaDelPedido) => {
    const partes = [
      p.cantoLargo ? `${p.cantoLargo} ${p.cantoLargo === 1 ? "largo" : "largos"}` : "",
      p.cantoAncho ? `${p.cantoAncho} ${p.cantoAncho === 1 ? "ancho" : "anchos"}` : "",
    ].filter(Boolean);
    return partes.length ? `, canto en ${partes.join(" y ")}` : "";
  };
  const bloques = grupos.map((g) =>
    [
      `Placa: ${g.placa}${g.mitad ? ` (media, al ${g.mitad})` : ""}`,
      ...g.piezas.map(
        (p) =>
          `• ${p.etiqueta ? `${p.etiqueta}: ` : ""}${p.cantidad} de ${p.largoMm} × ${p.anchoMm} mm${p.respetaVeta ? ", con veta" : ""}${lados(p)}`,
      ),
      ...(g.canto.trim() ? [`Tapacanto: ${g.canto.trim()}`] : []),
    ].join("\n"),
  );
  return ["Hola! Quería pedir este corte:", bloques.join("\n\n"), enlace].join("\n");
}
