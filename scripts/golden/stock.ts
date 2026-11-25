/**
 * Golden del stock del panel: lo que contestaban los esquemas de la
 * transferencia y del ajuste rápido (app/admin/stock), con leerCantidad y
 * cantidadDeStock de lib/unidades.ts. El Go (internal/stock) tiene que dar lo
 * mismo.
 *
 *   npx tsx scripts/golden/stock.ts
 */
import { writeFileSync } from "node:fs";
import { z } from "zod";
import { cantidadDeStock, formatearUnidadLarga, leerCantidad } from "../../lib/unidades";

// Copiados de app/admin/stock/actions.ts y ajuste-actions.ts (git 5dea0ec).
const transferenciaSchema = z.object({
  variantId: z.string().uuid("Elegí un producto."),
  origenId: z.string().uuid("Elegí la sucursal de origen."),
  destinoId: z.string().uuid("Elegí la sucursal de destino."),
  cantidad: z.preprocess(
    (v) => cantidadDeStock(leerCantidad(v as string)),
    z.number().finite("La cantidad tiene que ser un número.").positive("La cantidad tiene que ser mayor a cero."),
  ),
  nota: z.string().trim().max(300).optional(),
});

const U = "8f2b5c1e-1d2a-4c3b-9a8e-111111111111";
const casos: Record<string, unknown>[] = [
  ...["abc", "", "0", "-1", "2,5", "1e3", "2.", " 3 ", "0,0004", "1,2345", "1.000", "12"].map((cantidad) => ({ variantId: U, origenId: U, destinoId: U, cantidad })),
  { variantId: "", origenId: U, destinoId: U, cantidad: "1" },
  { variantId: U, origenId: "x", destinoId: U, cantidad: "1" },
  { variantId: U, origenId: U, destinoId: "", cantidad: "abc" },
  { variantId: U, origenId: U, destinoId: U, cantidad: "1", nota: "  Para la obra  " },
  { variantId: U, origenId: U, destinoId: U, cantidad: "1", nota: "x".repeat(301) },
];
const transferencias = casos.map((entrada) => {
  const r = transferenciaSchema.safeParse(entrada);
  return r.success ? { entrada, cantidad: r.data.cantidad, nota: r.data.nota ?? null } : { entrada, error: r.error.issues[0]?.message };
});

const lecturas = ["2,5", "2.5", "2", "", " 7 ", "-3", "1,2,3", "abc", "1e3", ".5", "5."].map((t) => {
  const n = leerCantidad(t);
  return { t, n: Number.isNaN(n) ? "NaN" : n };
});
const redondeos = [0.1 + 0.2, 1.0005, 2.4999, 1234.56789, -0.0005, 7].map((v) => ({ v, r: cantidadDeStock(v) }));
const unidades = ["unidad", "metro_lineal", "metro_cuadrado", "tabla", "placa", "kg", "litro", "par", "juego", "rollo", "otra_cosa"].map((u) => ({
  u,
  larga: formatearUnidadLarga(u),
}));

const destino = new URL("../../backend/testdata/golden/stock/validacion.json", import.meta.url);
writeFileSync(destino, JSON.stringify({ transferencias, lecturas, redondeos, unidades }, null, 1) + "\n");
console.log(`${transferencias.length} transferencias en ${destino.pathname}`);
