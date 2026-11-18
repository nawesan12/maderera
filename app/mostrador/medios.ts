import { Banknote, CreditCard, Landmark, NotebookPen, ScrollText } from "lucide-react";
import type { ChequeDePago, MedioDeMostrador } from "@/lib/mostrador/importes";

export const MEDIOS: { valor: MedioDeMostrador; texto: string; Icono: typeof Banknote }[] = [
  { valor: "efectivo", texto: "Efectivo", Icono: Banknote },
  { valor: "debito", texto: "Débito", Icono: CreditCard },
  { valor: "credito", texto: "Crédito", Icono: CreditCard },
  { valor: "transferencia", texto: "Transferencia", Icono: Landmark },
  // Cheque o e-Cheq: entra a la cartera con la venta (nota del 30/9/2026).
  { valor: "cheque", texto: "Cheque", Icono: ScrollText },
  { valor: "cuenta_corriente", texto: "Cuenta corriente", Icono: NotebookPen },
];

/**
 * Los medios de contado.
 *
 * La cuenta corriente no está acá: no es una forma de pagar sino **un tipo de
 * operación**, y tenerla en los dos lados obligaba a elegir lo mismo dos veces.
 * El orden es el que se ve en pantalla, que es el de `Alt + 1` a `Alt + 4`.
 */
export const MEDIOS_DE_CONTADO = MEDIOS.filter((m) => m.valor !== "cuenta_corriente");

/** Las tres formas de vender. El comentario largo está en `Cobro`. */
export type TipoDeOperacion = "contado" | "cuenta" | "acopio";

export const TIPOS_DE_OPERACION: {
  clave: TipoDeOperacion;
  texto: string;
  detalle: string;
}[] = [
  { clave: "contado", texto: "Contado", detalle: "Paga y se lo lleva" },
  {
    clave: "cuenta",
    texto: "Cuenta corriente",
    detalle: "Se lo lleva y queda anotado",
  },
  { clave: "acopio", texto: "Acopio", detalle: "Paga y lo retira después" },
];

/*
 * Cuál de los tres está elegido. No se guarda en su propio estado: se lee del
 * acopio y del medio, que son los que viajan con la venta. Un cuarto estado
 * que dijera lo mismo es el que un día queda desincronizado.
 */
export function esElTipo(
  clave: TipoDeOperacion,
  acopio: boolean,
  medio: MedioDeMostrador,
) {
  if (clave === "acopio") return acopio;
  if (clave === "cuenta") return !acopio && medio === "cuenta_corriente";
  return !acopio && medio !== "cuenta_corriente";
}

/*
 * El mismo nombre de cada medio, para el cierre del turno. Se deriva de
 * `MEDIOS` y no se escribe de nuevo: dos listas del mismo dato terminan
 * diciendo cosas distintas.
 */
export const NOMBRE_DEL_MEDIO: Record<string, string> = Object.fromEntries(
  MEDIOS.map((m) => [m.valor, m.texto]),
);


/** Un renglón del pago partido, con los importes como texto porque se tipean. */
export interface ParteDePago {
  medio: MedioDeMostrador;
  importe: string;
  nroLote: string;
  nroCupon: string;
  tarjeta: string;
  cuotas: number;
  /** Solo si el medio es cheque. */
  cheque?: ChequeEnPantalla;
}

/** El cheque como se tipea: todo texto hasta cobrar. */
export interface ChequeEnPantalla {
  tipo: "fisico" | "echeq";
  banco: string;
  numero: string;
  fechaPago: string;
  librador: string;
}

export const CHEQUE_VACIO: ChequeEnPantalla = {
  tipo: "fisico",
  banco: "",
  numero: "",
  fechaPago: "",
  librador: "",
};

export function aChequeDePago(c: ChequeEnPantalla | undefined): ChequeDePago | null {
  if (!c) return null;
  return {
    tipo: c.tipo,
    banco: c.banco.trim(),
    numero: c.numero.trim(),
    fechaPago: c.fechaPago,
    librador: c.librador.trim() || null,
  };
}

/**
 * Los planes que se ofrecen.
 *
 * Son los que aparecen en las promociones de los bancos: 3, 6 y 12 sin interés
 * son los que de verdad se usan, y 18 y 24 existen en algunos convenios. No se
 * ofrece cualquier número porque tipear "7 cuotas" no le sirve a nadie.
 */
export const CUOTAS = [1, 3, 6, 9, 12, 18, 24] as const;
