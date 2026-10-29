/**
 * Las reglas de un cobro, sin base de datos.
 *
 * Un cobro es una vez que el cliente paga, con uno o varios medios: tres
 * cheques y un poco de efectivo. Cada medio es una parte del recibo. Lo que
 * decide si las partes tienen sentido vive acá para poder probarlo; lo que
 * escribe vive en `recibo.ts`.
 */

import { revisarNumeroDeCheque } from "@/lib/cheques/numero";

export type MedioDeCobro =
  | "efectivo"
  | "transferencia"
  | "deposito"
  | "cheque"
  | "echeq"
  | "tarjeta_debito"
  | "tarjeta_credito"
  | "mercado_pago"
  | "retencion";

/** Cómo se nombra cada medio en el recibo, el panel y Mi cuenta. */
export const NOMBRE_DEL_MEDIO: Record<MedioDeCobro, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  deposito: "Depósito bancario",
  cheque: "Cheque",
  echeq: "e-Cheq",
  tarjeta_debito: "Tarjeta de débito",
  tarjeta_credito: "Tarjeta de crédito",
  mercado_pago: "Mercado Pago",
  retencion: "Retención",
};

/** Un cheque que entra con el cobro y todavía no está en la cartera. */
export interface ChequeNuevo {
  numero: string;
  banco: string;
  librador?: string | null;
  fechaPago: Date;
  emision?: Date | null;
}

export interface ParteDeCobro {
  medio: MedioDeCobro;
  importe: number;
  /** Número de operación, de lote o de cupón. */
  referencia?: string | null;
  /** Un cheque que ya existe: el que el cliente informó, o uno de la cartera. */
  chequeId?: string | null;
  /** O uno nuevo, que nace con el cobro. */
  cheque?: ChequeNuevo | null;
  /** La transferencia o el pago online conciliado. */
  paymentId?: string | null;
}

export function esCheque(medio: MedioDeCobro): medio is "cheque" | "echeq" {
  return medio === "cheque" || medio === "echeq";
}

export function aCentavos(n: number): number {
  return Math.round(n * 100) / 100;
}

export function totalDePartes(partes: Pick<ParteDeCobro, "importe">[]): number {
  return aCentavos(partes.reduce((s, p) => s + aCentavos(p.importe), 0));
}

/**
 * Qué le falta o le sobra a un cobro. Devuelve el motivo listo para mostrar,
 * o `null` si está bien.
 *
 * `circuito` es el del cobro: un e-Cheq no puede ir por el circuito B, porque
 * queda registrado en el banco a nombre de la empresa (la misma regla de
 * `lib/retenciones/pago.ts` y del alta de cheques).
 */
export function revisarPartes(
  partes: ParteDeCobro[],
  circuito: "blanco" | "negro" = "blanco",
): string | null {
  if (partes.length === 0) return "Cargá con qué paga.";

  for (const [i, p] of partes.entries()) {
    const cual = partes.length > 1 ? ` (renglón ${i + 1})` : "";

    if (!Number.isFinite(p.importe) || p.importe <= 0) {
      return `El importe tiene que ser mayor a cero${cual}.`;
    }

    if (esCheque(p.medio)) {
      if (!p.chequeId && !p.cheque) return `Faltan los datos del cheque${cual}.`;
      if (p.cheque) {
        const problema = revisarNumeroDeCheque(p.cheque.numero);
        if (problema) return problema + cual;
        if (!p.cheque.banco.trim()) return `Poné el banco del cheque${cual}.`;
        if (!(p.cheque.fechaPago instanceof Date) || Number.isNaN(p.cheque.fechaPago.getTime())) {
          return `Poné la fecha de pago del cheque${cual}.`;
        }
      }
      if (p.medio === "echeq" && circuito === "negro") {
        return "Un e-Cheq no puede ir por el circuito B: queda registrado en el banco a nombre de la empresa.";
      }
    } else if (p.cheque || p.chequeId) {
      return `Hay datos de cheque en un pago que no es con cheque${cual}.`;
    }
  }

  // El mismo cheque dos veces en un cobro es un doble clic, no dos cheques.
  const ids = partes.map((p) => p.chequeId).filter(Boolean);
  if (new Set(ids).size !== ids.length) return "El mismo cheque está cargado dos veces.";

  return null;
}

const UNIDADES = [
  "", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
  "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete",
  "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés",
  "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve",
];
const DECENAS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const CENTENAS = [
  "", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos",
  "seiscientos", "setecientos", "ochocientos", "novecientos",
];

function hastaMil(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cien";
  const c = Math.floor(n / 100);
  const resto = n % 100;
  let texto = CENTENAS[c] ?? "";
  if (resto > 0) {
    const decenas =
      resto < 30
        ? UNIDADES[resto]!
        : `${DECENAS[Math.floor(resto / 10)]}${resto % 10 ? ` y ${UNIDADES[resto % 10]}` : ""}`;
    texto = texto ? `${texto} ${decenas}` : decenas;
  }
  return texto;
}

/**
 * Un importe en letras, como se escribe en un recibo: «son pesos ciento
 * veinte mil con 50/100».
 *
 * «Uno» se apocopa delante de «mil» y de «millones» («veintiún mil», «un
 * millón»), que es lo que más se equivoca a mano.
 */
export function importeEnLetras(importe: number): string {
  const entero = Math.floor(Math.abs(importe) + 1e-9);
  const centavos = Math.round((Math.abs(importe) - entero) * 100);

  const apocopar = (t: string) =>
    t.endsWith("veintiuno") ? t.replace(/veintiuno$/, "veintiún") : t.replace(/uno$/, "un");

  // Hasta 999.999 en palabras: «veintiún mil trescientos».
  const hastaUnMillon = (n: number): string => {
    const miles = Math.floor(n / 1000);
    const resto = n % 1000;
    const trozos: string[] = [];
    if (miles > 0) trozos.push(miles === 1 ? "mil" : `${apocopar(hastaMil(miles))} mil`);
    if (resto > 0) trozos.push(hastaMil(resto));
    return trozos.join(" ");
  };

  // Los millones pueden ser más de mil: 1.500.000.000 es «mil quinientos
  // millones». Antes se escribía con hastaMil y mil millones salía «millones».
  const millones = Math.floor(entero / 1_000_000);
  const resto = entero % 1_000_000;

  const partes: string[] = [];
  if (millones > 0) {
    partes.push(millones === 1 ? "un millón" : `${apocopar(hastaUnMillon(millones))} millones`);
  }
  if (resto > 0) partes.push(hastaUnMillon(resto));

  const letras = partes.length ? partes.join(" ") : "cero";
  return `${letras} con ${String(centavos).padStart(2, "0")}/100`;
}
