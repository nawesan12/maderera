/**
 * Golden de entregas y acopio (tanda 5): la parte pura de lib/entregas y de
 * las acciones de remitos, firma y zonas de envío, corrida en el TS de antes
 * (la copia de scripts/golden/originales/entregas.ts, commit 3f7910e), para
 * que internal/entregas dé lo mismo.
 *
 * - El saldo de cada renglón (saldoDeAcopio) y el del remito (saldoAlRemito).
 * - Lo que crearEntrega controlaba antes de sacar mercadería, si el pedido
 *   quedaba entregado, y lo que se guarda (toFixed(2)); las líneas del remito
 *   de constancia.
 * - Los formularios: prepararRemito (zod, el documento del retiro y las
 *   cantidades), la firma y la zona de envío (zod, parsearImporte, lo que se
 *   guarda y la línea de la bitácora). El primer error con su campo.
 *
 *   TZ=UTC npx tsx scripts/golden/entregas.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import {
  ErrorDeEntrega,
  esquemaFirma,
  esquemaZona,
  leerRemito,
  leerZona,
  lineasDeConstancia,
  renglon,
  saldoAlRemito,
  validarEntrega,
  cantidadGuardada,
} from "./originales/entregas";
import { z } from "zod";

let semilla = 20261105;
const azar = () => {
  semilla = (semilla * 1103515245 + 12345) % 2 ** 31;
  return semilla / 2 ** 31;
};
const entero = (n: number) => Math.floor(azar() * n);
const elegir = <T>(xs: readonly T[]): T => xs[entero(xs.length)];
const num = (x: number) => (Number.isNaN(x) ? "NaN" : x === Infinity ? "Inf" : x === -Infinity ? "-Inf" : x);

const uuid = () =>
  "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => "0123456789abcdef"[entero(16)]);
const PALABRAS = ["Tirante", "pino", "2x4", "Fenólico", "18mm", "çà", "😀", "OSB", "Lapacho", "x3,05m", "“premium”", "ñandubay"];
const frase = (n: number) => Array.from({ length: n }, () => elegir(PALABRAS)).join(" ");
const ESPACIOS = ["", " ", "  ", "\t", " ", "　", "\n"];
const largo = (n: number) => "a".repeat(n);
const texto = (max: number) => {
  const r = azar();
  if (r < 0.15) return elegir(ESPACIOS) + largo(max - 1 + entero(4)) + elegir(ESPACIOS);
  if (r < 0.25) return elegir(ESPACIOS);
  if (r < 0.3) return "😀".repeat(Math.floor(max / 2) + entero(3) - 1);
  return elegir(ESPACIOS) + frase(1 + entero(4)) + elegir(ESPACIOS);
};

/** Un numeric(12,2) como lo devuelve Postgres. */
const numeric = (max: number) => (Math.round(azar() * max * 100) / 100).toFixed(2);

// --- saldos ---

const filaAlAzar = () => {
  const pedido = elegir(["1.00", "0.50", "12.00", "3.25", numeric(50), numeric(5000), "0.00"]);
  const p = Number(pedido);
  const r = azar();
  const entregado =
    r < 0.2 ? "0" : r < 0.4 ? pedido : r < 0.5 ? (p + 0.01).toFixed(2) : r < 0.6 ? (p * 2).toFixed(2) : (Math.round(azar() * p * 100) / 100).toFixed(2);
  return { orderItemId: uuid(), descripcion: frase(1 + entero(3)), unidad: elegir(["unidad", "metro_lineal", "kg"]), pedido, entregado };
};

const saldos: unknown[] = [];
for (let i = 0; i < 1500; i++) {
  const filas = Array.from({ length: 1 + entero(5) }, filaAlAzar);
  saldos.push({ filas, renglones: filas.map(renglon), alRemito: saldoAlRemito(filas) });
}

// --- validar una entrega ---

const validaciones: unknown[] = [];
const casosFijos: { pendientes: number[]; lineas: (number | "ajeno")[] }[] = [
  { pendientes: [10], lineas: [] },
  { pendientes: [10], lineas: [0] },
  { pendientes: [10], lineas: [-1] },
  { pendientes: [10], lineas: [10] },
  { pendientes: [10], lineas: [10.01] },
  { pendientes: [10], lineas: [10.02] },
  { pendientes: [10], lineas: [10.011] },
  { pendientes: [10, 5], lineas: [10] },
  { pendientes: [10, 5], lineas: [9.99, 4.99] },
  { pendientes: [10, 5], lineas: [9.98, 5] },
  { pendientes: [0.3], lineas: [0.31] },
  { pendientes: [0.1 + 0.2], lineas: [0.31] },
  { pendientes: [10], lineas: ["ajeno"] },
  { pendientes: [10, 0], lineas: [10] },
  { pendientes: [], lineas: [1] },
];
const pendientesDe = (ns: number[]) =>
  ns.map((n, i) => ({ orderItemId: `item-${i}`, descripcion: frase(2), unidad: "unidad", pedido: n, entregado: 0, pendiente: n }));
const correr = (pendientes: ReturnType<typeof pendientesDe>, lineas: { orderItemId: string; cantidad: number }[]) => {
  try {
    const r = validarEntrega(pendientes, { lineas });
    return { lineas: r.lineas, guardadas: r.lineas.map((l) => cantidadGuardada(l.cantidad)), completo: r.completo };
  } catch (e) {
    if (e instanceof ErrorDeEntrega) return { error: e.message };
    throw e;
  }
};
for (const c of casosFijos) {
  const pendientes = pendientesDe(c.pendientes);
  const lineas = c.lineas.map((x, i) => (x === "ajeno" ? { orderItemId: uuid(), cantidad: 1 } : { orderItemId: `item-${i}`, cantidad: x }));
  validaciones.push({ pendientes, lineas, salida: correr(pendientes, lineas) });
}
for (let i = 0; i < 4000; i++) {
  const pendientes = Array.from({ length: entero(6) }, filaAlAzar).map(renglon);
  // Una línea por renglón como mucho (el formulario tiene una por renglón);
  // dos líneas del mismo renglón es el bug que Go arregla (prueba aparte).
  const lineas: { orderItemId: string; cantidad: number }[] = [];
  for (const p of pendientes) {
    if (azar() < 0.3) continue;
    const r = azar();
    const cantidad =
      r < 0.1 ? 0 : r < 0.15 ? -1 : r < 0.35 ? p.pendiente : r < 0.45 ? p.pendiente + elegir([0.005, 0.01, 0.0100001, 0.011, 0.02, 1]) :
      r < 0.55 ? Math.max(p.pendiente - elegir([0.005, 0.01, 0.011, 0.02]), 0.001) : Math.round(azar() * (p.pendiente + 1) * 1000) / 1000;
    lineas.push({ orderItemId: p.orderItemId, cantidad });
  }
  if (azar() < 0.05) lineas.splice(entero(lineas.length + 1), 0, { orderItemId: uuid(), cantidad: 1 });
  // El orden de las líneas lo da el formulario, no el pedido.
  if (azar() < 0.3) lineas.reverse();
  validaciones.push({ pendientes, lineas, salida: correr(pendientes, lineas) });
}

const constancias: unknown[] = [];
for (let i = 0; i < 1000; i++) {
  const pendientes = Array.from({ length: entero(6) }, filaAlAzar).map(renglon);
  constancias.push({ pendientes, lineas: lineasDeConstancia(pendientes) });
}

// --- los formularios ---

/** El campo del primer error de zod (vacío si zod no falló). */
const campoDe = (esquema: z.ZodType, entrada: unknown) => {
  const r = esquema.safeParse(entrada);
  return r.success ? "" : r.error.issues[0].path.join(".");
};

const esquemaRemito = z.object({
  orderId: z.string().uuid(),
  tipo: z.enum(["retiro", "envio"]),
  receptorNombre: z.string().trim().max(120).optional(),
  receptorDocumento: z.string().trim().max(30).optional(),
  transportista: z.string().trim().max(80).optional(),
  numeroSeguimiento: z.string().trim().max(60).optional(),
  notas: z.string().trim().max(400).optional(),
});

const raro = () => elegir<unknown>([null, 12, true, ["a"], { a: 1 }]);
/** Un campo opcional del formulario: `(x as string) || undefined`. */
const opcional = (max: number) => {
  const r = azar();
  if (r < 0.3) return undefined;
  if (r < 0.33) return raro();
  return texto(max) || undefined;
};

const remitos: unknown[] = [];
for (let i = 0; i < 3000; i++) {
  const entrada: Record<string, unknown> = {
    orderId: azar() < 0.9 ? uuid() : elegir(["", "no-es-uuid", uuid().toUpperCase(), uuid().slice(1), "00000000-0000-0000-0000-000000000000"]),
    tipo: azar() < 0.95 ? elegir(["retiro", "envio"]) : elegir(["", "Retiro", "otro"]),
    receptorNombre: opcional(120),
    receptorDocumento: azar() < 0.6 ? elegir(["30111222", "20-30111222-9", " 30.111.222 ", " "]) : opcional(30),
    transportista: opcional(80),
    numeroSeguimiento: opcional(60),
    notas: opcional(400),
  };
  if (azar() < 0.02) entrada.orderId = raro();
  if (azar() < 0.02) entrada.tipo = raro();
  for (const k of Object.keys(entrada)) if (entrada[k] === undefined) delete entrada[k];
  const entradas: [string, string][] = [["orderId", String(entrada.orderId)]];
  for (let j = 0; j < entero(5); j++) {
    const valor = elegir(["1", "2,5", "2.5", "0", "-1", "", "abc", "1,5,5", " 3 ", "1e2", "Infinity", "0x10", "1.234,5", String(Math.round(azar() * 1e5) / 100)]);
    entradas.push([`cantidad-${uuid()}`, valor]);
  }
  if (azar() < 0.2) entradas.push(["otra", "1"]);
  const salida = leerRemito(entrada, entradas);
  const cantidades = entradas
    .filter(([k]) => k.startsWith("cantidad-"))
    .map(([k, v]) => ({ orderItemId: k.slice("cantidad-".length), valor: v }));
  remitos.push({
    entrada: { ...entrada, cantidades },
    salida,
    campo: "error" in salida ? campoDe(esquemaRemito, entrada) || "receptorDocumento" : "",
  });
}

const firmas: unknown[] = [];
const PNG = "data:image/png;base64,";
for (let i = 0; i < 2000; i++) {
  const r = azar();
  // Las de cien mil, pocas: el archivo crece de a 100 KB por caso.
  const firma =
    i < 6 ? PNG + "a".repeat(100_000 - PNG.length + (i % 3) - 1) :
    i < 8 ? (i === 6 ? "a" : "😀").repeat(100_001) :
    r < 0.7 ? PNG + "iVBORw0KGgo".repeat(1 + entero(20)) :
    r < 0.85 ? elegir(["data:image/jpeg;base64,xx", "", " data:image/png;base64,", "DATA:image/png;base64,x"]) : raro();
  const entrada: Record<string, unknown> = {
    token: azar() < 0.85 ? "t".repeat(32) : elegir(["", "corto", "x".repeat(9), "x".repeat(10), "x".repeat(120), "x".repeat(121), null]),
    receptorNombre: azar() < 0.8 ? texto(120) : elegir<unknown>(["ab", " ab ", "abc", null, 3]),
    receptorDocumento: opcional(30),
    firma,
  };
  for (const k of Object.keys(entrada)) if (entrada[k] === undefined) delete entrada[k];
  const p = esquemaFirma.safeParse(entrada);
  firmas.push({
    entrada,
    salida: p.success ? { data: p.data } : { error: p.error.issues[0].message, campo: p.error.issues[0].path.join(".") },
  });
}

const zonas: unknown[] = [];
const IMPORTES = ["0", "", "18.000", "18.000,50", "1.234.567", "12.34", "1,5", "-5", "abc", " 3 000 ", "1e3", "9999999999", "99999999.995", "0,001", "12.345.678,9", "1.5.5"];
for (let i = 0; i < 3000; i++) {
  const entrada: Record<string, unknown> = {
    id: azar() < 0.5 ? undefined : azar() < 0.9 ? uuid() : elegir(["x", "no-uuid"]),
    nombre: azar() < 0.85 ? texto(80) : elegir<unknown>([null, "", " ", "a"]),
    cobertura: azar() < 0.1 ? null : texto(300),
    demoraEstimada: azar() < 0.1 ? undefined : texto(120),
    aCotizar: azar() < 0.3,
    costo: elegir(IMPORTES) || "0",
    envioGratisDesde: elegir(IMPORTES) || "0",
    orden: elegir(["0", "1", "10", "-3", "1.5", "abc", "", "1e3", "-0", " 7 "]) || "0",
    activa: azar() < 0.8,
  };
  if (azar() < 0.03) entrada.aCotizar = raro();
  if (azar() < 0.03) entrada.costo = raro();
  for (const k of Object.keys(entrada)) if (entrada[k] === undefined) delete entrada[k];
  const salida = leerZona(entrada);
  const campo = "error" in salida ? campoDe(esquemaZona, entrada) : "";
  zonas.push({ entrada, salida, campo });
}

const dir = new URL("../../backend/testdata/golden/entregas/", import.meta.url);
mkdirSync(dir, { recursive: true });
const escribir = (nombre: string, v: unknown) =>
  writeFileSync(new URL(nombre, dir), JSON.stringify(v, (_k, x) => (typeof x === "number" ? num(x) : x)) + "\n");
escribir("saldos.json", saldos);
escribir("validaciones.json", validaciones);
escribir("constancias.json", constancias);
escribir("remitos.json", remitos);
escribir("firmas.json", firmas);
escribir("zonas.json", zonas);
console.log(
  `saldos ${saldos.length}, validaciones ${validaciones.length}, constancias ${constancias.length}, remitos ${remitos.length}, firmas ${firmas.length}, zonas ${zonas.length}`,
);
