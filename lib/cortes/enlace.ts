import { normalizar } from "@/lib/asistente/lenguaje";

/**
 * Lo que trae el enlace al cortador, por el hash (así la página se sigue
 * armando de antemano): `#placa=<variante>` desde la ficha de un producto, o
 * `#piezas=600x400x4c20v_300x200x2&material=melamina+blanca` desde el
 * asistente (`EnlaceDelDespiece` en backend/internal/asistente). En `c20`, el
 * 2 son los lados del largo con canto y el 0 los del ancho; la `v` del final
 * es que respeta la veta.
 *
 * La `v` llegó después (revisión del 18/11/2026): antes cada pieza del enlace
 * caía sin veta y había que volver a marcarla. Es opcional y va al final, así
 * que los enlaces ya mandados se leen igual.
 */
export interface PiezaDelEnlace {
  largo: number;
  ancho: number;
  cantidad: number;
  cantoLargo: number;
  cantoAncho: number;
  veta: boolean;
}

export interface EnlaceDeCorte {
  placa: string | null;
  piezas: PiezaDelEnlace[];
}

const PIEZA = /^(\d{1,4})x(\d{1,4})x(\d{1,3})(?:c([0-2])([0-2]))?(v)?$/;

export function leerPiezasDelEnlace(texto: string): PiezaDelEnlace[] {
  return texto
    .split("_")
    .map((t) => t.match(PIEZA))
    .filter((m): m is RegExpMatchArray => m !== null)
    .slice(0, 50)
    .map((m) => ({
      largo: Number(m[1]),
      ancho: Number(m[2]),
      cantidad: Number(m[3]),
      cantoLargo: Number(m[4] ?? 0),
      cantoAncho: Number(m[5] ?? 0),
      veta: m[6] === "v",
    }));
}

export function leerEnlaceDeCorte(hash: string, placas: { variantId: string; descripcion: string }[]): EnlaceDeCorte {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const piezas = leerPiezasDelEnlace(p.get("piezas") ?? "");

  let placa = p.get("placa");
  if (!placa || !placas.some((x) => x.variantId === placa)) {
    // Por el material dicho con palabras: la placa que tenga todas.
    const palabras = normalizar(p.get("material") ?? "").split(" ").filter((w) => w.length > 2);
    placa =
      palabras.length > 0
        ? (placas.find((x) => palabras.every((w) => normalizar(x.descripcion).includes(w)))?.variantId ??
          placas.find((x) => normalizar(x.descripcion).includes(palabras[0]))?.variantId ??
          null)
        : null;
  }
  return { placa, piezas };
}
