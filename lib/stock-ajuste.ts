import type { MotivoDeAjuste } from "@/app/admin/stock/ajuste-actions";

/*
 * El motivo fija la dirección: los de arriba suman y los de abajo restan, y
 * cada uno ejecuta. Antes había un motivo elegido aparte y dos botones
 * Sumar/Restar, y una «rotura» que sumaba se convertía callada en «otro»
 * (T4, hallazgo 21). Go rechaza las combinaciones que no tienen sentido.
 *
 * «Faltante» y no «Otro»: abajo, restando, «otro» no le decía nada a quien
 * lee el libro.
 *
 * La devolución va en las dos filas, como la deja Go: la del cliente entra y
 * la al proveedor sale. Solo arriba, la que se le devolvía al proveedor
 * terminaba asentada como «Faltante», que es justo la mentira en el libro que
 * el hallazgo 21 quería sacar (comité de T4). Go le pone al libro de qué lado
 * fue.
 */
export const MOTIVOS_QUE_SUMAN: { valor: MotivoDeAjuste; texto: string }[] = [
  { valor: "ingreso", texto: "Ingreso" },
  { valor: "devolucion", texto: "Devolución" },
];
// Restando, la devolución es la que sale al proveedor: «Devolución» a secas
// se leía como la del cliente, que suma (revisión del carril F).
// «Taller» es lo que gasta la seccionadora sin una venta que lo descuente, y
// «A cliente» lo que se le da a quien reclamó un faltante de su pedido: va
// con el número del pedido (mes simulado, H220 y H275).
export const MOTIVOS_QUE_RESTAN: { valor: MotivoDeAjuste; texto: string }[] = [
  { valor: "rotura", texto: "Rotura" },
  { valor: "faltante", texto: "Faltante" },
  { valor: "taller", texto: "Taller" },
  { valor: "devolucion", texto: "Al proveedor" },
  { valor: "reposicion", texto: "A cliente" },
];

/**
 * Los motivos de un conteo que no coincide, según para qué lado da la
 * diferencia: «Conteo» primero, que es lo que pasa casi siempre, y los que la
 * explican al lado. Un −18 se grababa sin preguntar por qué (H398).
 */
export function motivosDelConteo(diferencia: number): { valor: MotivoDeAjuste; texto: string }[] {
  const conteo = { valor: "conteo" as const, texto: "Conteo" };
  if (diferencia < 0) return [conteo, ...MOTIVOS_QUE_RESTAN.filter((m) => m.valor !== "devolucion" && m.valor !== "reposicion")];
  if (diferencia > 0) return [conteo, ...MOTIVOS_QUE_SUMAN];
  return [conteo];
}

/** Sumar, restar o contar: el cuadro del ajuste arranca en uno de los tres. */
export type ModoDelAjuste = "sumar" | "restar" | "contar";

/**
 * Qué hace una tecla en el campo del ajuste.
 *
 * Sumando, Enter es «Ingreso», el chip que lo dice. Restando no hace nada: el
 * motivo se toca, porque una rotura, un faltante y una devolución no son lo
 * mismo en el libro, y con Enter el que entraba a descontar una rotura
 * cargaba un ingreso (mes simulado, H106). Contando, Enter es «Conteo».
 * Mayús+Enter no hace nada: hasta T4 era «restar», el depósito lo aprendió
 * así, y si ahora sumara, el que quiere sacar 5 por rotura y lo aprieta por
 * costumbre deja el stock 10 arriba con un «Ingreso» en el libro (comité de
 * T4).
 */
export function teclaDelAjuste(
  e: { key: string; shiftKey: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean },
  modo: ModoDelAjuste,
): "ingreso" | "contar" | "nada" | null {
  if (e.key !== "Enter") return null;
  if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return "nada";
  if (modo === "contar") return "contar";
  return modo === "sumar" ? "ingreso" : "nada";
}

/**
 * Cómo está una sucursal, para el panel. `disponible` va con signo: menos de
 * cero es lo vendido de más, y se dice «Faltan» (mes simulado, H218: con 135
 * vendidas y 70 en el galpón, la tarjeta decía «0 · Sin stock»).
 *
 * «Va bajando» es hasta el doble del mínimo, no el triple que usa el sitio
 * público: una corredera recién cargada con 2,5 veces su mínimo aparecía en
 * amarillo (H013).
 */
export type EstadoEnSucursal = "faltante" | "sin-stock" | "reponer" | "va-bajando" | "bien";

export function estadoEnSucursal(disponible: number, minimo: number): EstadoEnSucursal {
  if (disponible < 0) return "faltante";
  if (disponible === 0) return "sin-stock";
  if (minimo > 0 && disponible <= minimo) return "reponer";
  if (minimo > 0 && disponible <= minimo * 2) return "va-bajando";
  return "bien";
}

/** El aviso de un ajuste, con el producto: dos avisos con «Deshacer» sin nombre se confundían. */
export function avisoDelAjuste(producto: string, mensaje: string): string {
  const p = producto.trim();
  return p ? `${p} · ${mensaje}` : mensaje;
}
