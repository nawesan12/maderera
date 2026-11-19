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
export const MOTIVOS_QUE_RESTAN: { valor: MotivoDeAjuste; texto: string }[] = [
  { valor: "rotura", texto: "Rotura" },
  { valor: "faltante", texto: "Faltante" },
  { valor: "devolucion", texto: "Devolución" },
];

/**
 * Qué hace una tecla en el campo del ajuste.
 *
 * Enter es «Ingreso», el chip que lo dice; restar se toca. Mayús+Enter no
 * hace nada: hasta T4 era «restar», el depósito lo aprendió así, y si ahora
 * sumara, el que quiere sacar 5 por rotura y lo aprieta por costumbre deja
 * el stock 10 arriba con un «Ingreso» en el libro (comité de T4).
 */
export function teclaDelAjuste(
  e: { key: string; shiftKey: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean },
  modo: "mover" | "contar",
): "ingreso" | "contar" | "nada" | null {
  if (e.key !== "Enter") return null;
  if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return "nada";
  return modo === "contar" ? "contar" : "ingreso";
}

/** El aviso de un ajuste, con el producto: dos avisos con «Deshacer» sin nombre se confundían. */
export function avisoDelAjuste(producto: string, mensaje: string): string {
  const p = producto.trim();
  return p ? `${p} · ${mensaje}` : mensaje;
}
