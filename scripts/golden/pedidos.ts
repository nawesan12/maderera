/**
 * Golden de los pedidos y presupuestos del panel (tanda 5, parte B): las
 * cuentas y los esquemas de zod de app/admin/ventas-actions.ts y lo que
 * calculaban lib/dal/admin/ventas.ts y la ficha del pedido, corridos en el
 * TypeScript real para que el Go (internal/pedidos) dé lo mismo, exacto.
 *
 * - `plazo.json`: estadoDelPlazo (lib/plazos.ts, el real) para el listado de
 *   presupuestos.
 * - `margen.json`: el margen de la ficha del pedido (calcularMargen, copiado
 *   tal cual de app/admin/pedidos/[id]/page.tsx en 295d7f2) sobre
 *   margenDeLinea (lib/compras/costo.ts, que se borró: la copia textual de
 *   scripts/golden/originales/costo.ts).
 * - `costo.json`: costoPorUnidadDeVenta (lib/compras/congelar.ts en 295d7f2,
 *   copiado: el archivo importa server-only).
 * - `crear.json`: crearPresupuesto entero salvo la base: los esquemas de zod
 *   de la cabecera y de cada línea (copiados de ventas-actions.ts en 295d7f2)
 *   con el primer error, y la plata que se guarda (toFixed(2) de cada cosa).
 *
 *   npx tsx scripts/golden/pedidos.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { estadoDelPlazo } from "../../lib/plazos";
import { margenDeLinea } from "./originales/costo";

const SALIDA = "backend/testdata/golden/pedidos";
mkdirSync(SALIDA, { recursive: true });

let semilla = 20261029;
const azar = () => {
  semilla = (semilla * 1103515245 + 12345) % 2 ** 31;
  return semilla / 2 ** 31;
};
const entero = (n: number) => Math.floor(azar() * n);
const elegir = <T>(xs: readonly T[]): T => xs[entero(xs.length)];
const uuid = () => {
  const h = () => entero(16).toString(16);
  const n = (k: number) => Array.from({ length: k }, h).join("");
  return `${n(8)}-${n(4)}-4${n(3)}-${elegir(["8", "9", "a", "b"])}${n(3)}-${n(12)}`;
};

/* ------------------------------ el plazo ------------------------------ */

const ahora = new Date(Date.UTC(2026, 9, 29, 15, 0, 0));
const deltas = [
  0, -1, 1, -59_999, -60_000, 29_999, 30_000, 30_001, 59_999, 60_000, 89_999, 90_000, 3_599_999, 3_600_000,
  3_600_001, -3_599_999, -3_600_000, -3_600_001, 14_399_999, 14_400_000, 86_399_999, 86_400_000, 86_400_001,
  -86_400_000, 172_800_000, 1_000, -7_200_000,
  // Los de tests/plazos.test.ts: 3 h, 2 días, hace 5 h, 20 min.
  10_800_000, -18_000_000, 1_200_000,
];
for (let i = 0; i < 4000; i++) {
  const escala = elegir([60_000, 3_600_000, 86_400_000, 864_000_000]);
  deltas.push(Math.round((azar() * 2 - 1) * escala));
}
const plazos = deltas.map((ms) => ({ ms, ...estadoDelPlazo(new Date(ahora.getTime() + ms), ahora) }));
writeFileSync(`${SALIDA}/plazo.json`, JSON.stringify(plazos));

/* ------------------------------ el margen ----------------------------- */

// Copia textual de app/admin/pedidos/[id]/page.tsx (295d7f2).
function calcularMargen(
  items: { subtotal: string; cantidad: string; alicuotaIva: string | null; costoUnitario: string | null }[],
) {
  let neto = 0;
  let costo = 0;
  let conCosto = 0;
  let sinCosto = 0;

  for (const item of items) {
    const r = margenDeLinea({
      subtotal: Number(item.subtotal),
      cantidad: Number(item.cantidad),
      alicuotaIva: Number(item.alicuotaIva ?? 21),
      costoUnitario: item.costoUnitario === null ? null : Number(item.costoUnitario),
    });

    if (r.costoTotal === null) {
      sinCosto += 1;
      continue;
    }

    neto += r.netoVenta;
    costo += r.costoTotal;
    conCosto += 1;
  }

  if (conCosto === 0) return null;

  return { neto, costo, ganancia: neto - costo, sinCosto };
}

const dos = (x: number) => x.toFixed(2);
const margenes: unknown[] = [];
for (let i = 0; i < 3000; i++) {
  const items = Array.from({ length: 1 + entero(8) }, () => {
    const cantidad = elegir([1, 2, 3, 0.5, 0.25, 1.33]) * (1 + entero(40));
    const precio = Math.round(azar() * elegir([1e4, 1e6, 1e8])) / 100;
    const costo =
      azar() < 0.3 ? null : (Math.round(azar() * precio * elegir([0.3, 0.7, 1.1]) * 1e4) / 1e4).toFixed(4);
    return {
      subtotal: dos(cantidad * precio),
      cantidad: dos(cantidad),
      alicuotaIva: azar() < 0.15 ? null : elegir(["21.00", "10.50", "0.00", "27.00", "2.50"]),
      costoUnitario: costo,
    };
  });
  margenes.push({ items, margen: calcularMargen(items) });
}
writeFileSync(`${SALIDA}/margen.json`, JSON.stringify(margenes));

/* --------------------------- el costo congelado ----------------------- */

// Copia textual de lib/compras/congelar.ts (295d7f2).
function costoPorUnidadDeVenta(costoPorUnidadDeStock: string | null | undefined, stockPorUnidad: number): string | null {
  if (costoPorUnidadDeStock == null) return null;
  return (Number(costoPorUnidadDeStock) * stockPorUnidad).toFixed(4);
}
const costos: unknown[] = [];
for (let i = 0; i < 3000; i++) {
  const costo = azar() < 0.1 ? null : (Math.round(azar() * elegir([1e4, 1e7, 1e9])) / 1e4).toFixed(4);
  const factor = elegir([1, 0.5, 2.88, 1.44, 0.333333, 5.796, Math.round(azar() * 1e6) / 1e6]);
  costos.push({ costo, factor, resultado: costoPorUnidadDeVenta(costo, factor) });
}
writeFileSync(`${SALIDA}/costo.json`, JSON.stringify(costos));

/* --------------------------- crear un presupuesto --------------------- */

// Copia textual de app/admin/ventas-actions.ts (295d7f2).
const DIAS_DE_VALIDEZ = 15;

const lineaPresupuesto = z.object({
  variantId: z.string().uuid().nullable(),
  descripcion: z.string().trim().min(1).max(300),
  unidad: z.string().trim().max(30).default("unidad"),
  cantidad: z.coerce.number().positive().max(1_000_000),
  precioUnitario: z.coerce.number().min(0).max(100_000_000),
});

const cabeceraSchema = z.object({
  customerId: z.string().uuid().optional(),
  contactoNombre: z.string().trim().min(2, "Poné a nombre de quién va.").max(160),
  contactoTelefono: z.string().trim().max(40).optional(),
  contactoEmail: z.string().trim().email("Revisá el correo.").optional().or(z.literal("")),
  branchId: z.string().uuid().optional(),
  sellerId: z.string().uuid().optional(),
  notas: z.string().trim().max(1000).optional(),
  diasValidez: z.coerce.number().int().min(1).max(180).default(DIAS_DE_VALIDEZ),
});

/** Lo mismo que hace la acción con lo que leyó, sin la base. */
function crear(entrada: Record<string, unknown>, lineasCrudas: unknown[]) {
  const cabecera = cabeceraSchema.safeParse(entrada);
  if (!cabecera.success) {
    const i = cabecera.error.issues[0];
    return { error: i?.message ?? "Revisá los datos.", campo: (i?.path ?? []).join(".") };
  }
  const lineas: z.infer<typeof lineaPresupuesto>[] = [];
  for (const cruda of lineasCrudas) {
    const parseada = lineaPresupuesto.safeParse(cruda);
    if (!parseada.success) return { error: "Hay una línea con datos incompletos.", campo: "" };
    lineas.push(parseada.data);
  }
  if (lineas.length === 0) return { error: "Agregá al menos un producto.", campo: "" };

  const subtotal = lineas.reduce((suma, l) => suma + l.cantidad * l.precioUnitario, 0);
  return {
    cabecera: cabecera.data,
    lineas,
    subtotal: subtotal.toFixed(2),
    items: lineas.map((linea) => ({
      cantidad: linea.cantidad.toFixed(2),
      precioUnitario: linea.precioUnitario.toFixed(2),
      subtotal: (linea.cantidad * linea.precioUnitario).toFixed(2),
    })),
  };
}

const largo = (n: number) => "x".repeat(n);
const ids = () => elegir([undefined, uuid(), uuid().toUpperCase(), "no-es-uuid", "00000000-0000-0000-0000-000000000000", ""]);

function cabeceraAlAzar(): Record<string, unknown> {
  // Lo que arma la acción con el FormData: `|| undefined` en los opcionales,
  // `formData.get(...)` (texto o null) en el nombre, `|| 15` en la validez.
  const o: Record<string, unknown> = {
    customerId: azar() < 0.7 ? undefined : ids() || undefined,
    contactoNombre: azar() < 0.85 ? elegir(["Juan Pérez", "  Ana  ", "Carpintería Sur 🪵", "Lu"]) : elegir([null, "", " a ", "x", largo(160), largo(161), " " + largo(160) + " "]),
    contactoTelefono: azar() < 0.6 ? undefined : elegir(["223 555-1234", "  ", largo(40), largo(41)]),
    contactoEmail: azar() < 0.6 ? undefined : elegir(["a@b.co", "malo", " x@y.com ", "a..b@c.com", ".a@b.com", "a@b.c", "ñ@b.com", "a@b-.com", "a.@b.com", "  ", "a+b@sub.dominio.com.ar"]),
    branchId: azar() < 0.3 ? undefined : ids() || undefined,
    sellerId: azar() < 0.8 ? undefined : ids() || undefined,
    notas: azar() < 0.6 ? undefined : elegir(["Entrega el lunes", "   ", largo(1000), largo(1001)]),
    diasValidez: azar() < 0.7 ? DIAS_DE_VALIDEZ : elegir(["30", "0", "1", "180", "181", "1.5", "abc", "  7 ", "1e2", "0x10", "Infinity", " ", "-3", "15"]),
  };
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

function lineaAlAzar(): unknown {
  const r = azar();
  if (r < 0.02) return elegir([null, 3, "x", [], true]);
  const raro = r < 0.06;
  const l: Record<string, unknown> = {
    variantId: raro ? elegir([null, uuid(), "x", undefined, 3]) : elegir([null, uuid()]),
    descripcion: raro ? elegir([" Tabla ", "", "  ", largo(300), largo(301), 3, undefined]) : elegir(["Placa MDF 18 mm — 2,60 × 1,83", "Tirante 2x3"]),
    unidad: raro ? elegir([undefined, "m2", " placa ", largo(30), largo(31), null]) : elegir(["unidad", "m2", "metro_lineal"]),
    cantidad: raro
      ? elegir([1, "2.5", "0", -1, "abc", 1e6, 1_000_001, "", null, true, " 3 ", "1e3", undefined])
      : elegir([1, 2, 10, 0.5, 1.333, Math.round(azar() * 1e5) / 1e3, String(1 + entero(50))]),
    precioUnitario: raro
      ? elegir([0, "0", -0.01, "1e8", 100_000_001, "abc", "", null, false, undefined])
      : elegir([Math.round(azar() * 1e7) / 100, Math.round(azar() * 1e9) / 100, String(Math.round(azar() * 1e6) / 100), 0.1, 0.07]),
  };
  for (const k of Object.keys(l)) if (l[k] === undefined) delete l[k];
  return l;
}

const altas: unknown[] = [];
for (let i = 0; i < 5000; i++) {
  const entrada = cabeceraAlAzar();
  const n = azar() < 0.05 ? 0 : 1 + entero(azar() < 0.1 ? 30 : 5);
  const lineas = Array.from({ length: n }, lineaAlAzar);
  altas.push({ entrada, lineas, resultado: crear(entrada, lineas) });
}
writeFileSync(`${SALIDA}/crear.json`, JSON.stringify(altas));

console.log(
  `plazo ${plazos.length}, margen ${margenes.length}, costo ${costos.length}, crear ${altas.length} (` +
    `${altas.filter((a) => !("error" in (a as { resultado: object }).resultado)).length} válidos)`,
);
