// Las respuestas guardadas con datos vivos: {nombre}, {saldo}, {pedido},
// {estado}, {presupuesto}, {limite}. Se completan con la ficha del cliente
// al insertarlas; lo que no se sabe queda entre llaves para completarlo a
// mano (mejor eso que un hueco que nadie ve).

import type { Ficha } from "./clientes.svelte";

const estadosPedido: Record<string, string> = {
  pendiente: "pendiente",
  preparando: "en preparación",
  listo: "listo para retirar",
  "en-camino": "en camino",
};

function pesos(n: number): string {
  const entero = Math.abs(n) % 1 === 0;
  return "$ " + n.toLocaleString("es-AR", { minimumFractionDigits: entero ? 0 : 2, maximumFractionDigits: 2 });
}

export const camposVivos: [string, string][] = [
  ["{nombre}", "el nombre del cliente"],
  ["{saldo}", "lo que debe (o «al día»)"],
  ["{pedido}", "el número de su pedido abierto"],
  ["{estado}", "cómo está ese pedido"],
  ["{presupuesto}", "su último presupuesto"],
  ["{limite}", "su límite de crédito"],
];

export function rellenar(texto: string, ficha: Ficha | null, nombre = ""): string {
  const p = ficha?.pedidos[0];
  const valores: Record<string, string | undefined> = {
    nombre: ficha?.nombre ?? (nombre || undefined),
    saldo: ficha ? (ficha.saldo > 0.005 ? pesos(ficha.saldo) : "$ 0 (está al día)") : undefined,
    pedido: p ? p.numero.replace(/^PED-/, "") : undefined,
    estado: p ? (estadosPedido[p.estado] ?? p.estado) : undefined,
    presupuesto: ficha?.ultimoPresupuesto ? `${ficha.ultimoPresupuesto.numero} por ${pesos(ficha.ultimoPresupuesto.total)}` : undefined,
    limite: ficha && ficha.limiteCredito > 0 ? pesos(ficha.limiteCredito) : undefined,
  };
  return texto.replace(/\{(\w+)\}/g, (todo, campo: string) => valores[campo.toLowerCase()] ?? todo);
}
