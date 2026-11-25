/**
 * Golden de lib/csv-excel.ts (el CSV para Excel en español de las
 * exportaciones: libro IVA compras, cierre de caja, pagos a proveedores). Go
 * (internal/csvexcel) tiene que dar lo mismo, byte a byte.
 *
 * Las fechas se formatean en la zona de Argentina (en producción el TS usaba
 * la del contenedor, UTC: ver internal/csvexcel).
 *
 *   npx tsx scripts/golden/csv-excel.ts
 */
process.env.TZ = "America/Argentina/Buenos_Aires";

import { mkdirSync, writeFileSync } from "node:fs";
import { armarCsv, enteroCsv, fechaCsv, numeroCsv, textoCsv } from "@/lib/csv-excel";
import { azarCon, PALABRAS } from "./pdf/_azar";

const { azar, entero, elegir, palabras } = azarCon(1230);

const numeros: number[] = [0, -0, 0.005, 0.015, 1.005, 2.675, -1.005, 1e21, 1.5e-7, 123456789.125, -0.0049, 0.5, -0.5, 2.5, -2.5,
  1e15 + 0.3, NaN, Infinity, -Infinity];
for (let i = 0; i < 2000; i++) {
  const r = azar();
  numeros.push(r < 0.3 ? Math.round((azar() - 0.3) * 1e8) / 100 : r < 0.6 ? (azar() - 0.5) * 10 ** entero(16) : entero(100000) / 1000);
}
const fmt = (v: number) => (Object.is(v, -0) ? "-0" : Number.isFinite(v) ? v : String(v));

const textos: (string | null)[] = [null, "", '"', 'dijo "hola"', "a;b", "salto\nde línea", "Melamínica", "😀", ...PALABRAS];
for (let i = 0; i < 200; i++) textos.push(palabras(entero(6)));

const fechas: (string | null)[] = [null, "2026-03-05T15:04:05.000Z", "2026-01-01T02:59:59.999Z", "2026-01-01T03:00:00.000Z", "1999-12-31T23:59:59.000Z"];
for (let i = 0; i < 200; i++) fechas.push(new Date(1.5e12 + entero(2e11) * 1000 + entero(1000)).toISOString());

const archivos = Array.from({ length: 30 }, () => {
  const columnas = 1 + entero(6);
  const encabezados = Array.from({ length: columnas }, () => elegir(textos) ?? "");
  const filas = Array.from({ length: entero(20) }, () => Array.from({ length: columnas }, () => palabras(entero(3))));
  const totales = azar() < 0.5 ? Array.from({ length: columnas }, () => palabras(1)) : undefined;
  return { encabezados, filas, totales, salida: armarCsv(encabezados, filas, totales) };
});

const salida = {
  numeroCsv: numeros.flatMap((v) => [0, 1, 2, 3, 4].map((d) => ({ v: fmt(v), d, s: numeroCsv(v, d) }))),
  numeroCsv2: numeros.map((v) => ({ v: fmt(v), s: numeroCsv(v) })),
  enteroCsv: numeros.map((v) => ({ v: fmt(v), s: enteroCsv(v) })),
  textoCsv: textos.map((t) => ({ t, s: textoCsv(t) })),
  fechaCsv: fechas.map((f) => ({ f, s: fechaCsv(f ? new Date(f) : null) })),
  armarCsv: archivos,
};

const destino = new URL("../../backend/testdata/golden/csvexcel/", import.meta.url);
mkdirSync(destino, { recursive: true });
writeFileSync(new URL("casos.json", destino), JSON.stringify(salida) + "\n");
console.log(`csv-excel: ${salida.numeroCsv.length + salida.enteroCsv.length + salida.textoCsv.length + salida.fechaCsv.length + archivos.length} casos`);
