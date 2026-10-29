/**
 * Golden de los formatos de números de es-AR que usan los mensajes: el de
 * moneda con dos decimales («$ 1.234,56», toLocaleString con currency ARS) y
 * el número sin opciones («1.234,567», toLocaleString("es-AR")). El Go
 * (internal/formato) tiene que dar lo mismo.
 *
 *   npx tsx scripts/golden/formatos.ts
 */
import { writeFileSync } from "node:fs";

let semilla = 7;
const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2 ** 31), semilla / 2 ** 31);
const valores = [0, -0, 1, 0.5, 0.125, 0.005, 1.005, 2.675, 1234.5678, 1234567.891, -1234.5, 999.9995, 1e15, 0.0004, 12.3456, 100000, -0.001];
for (let i = 0; i < 3000; i++) valores.push(Math.round((azar() - 0.3) * 1e9) / 1000);
const casos = valores.map((v) => ({
  v,
  moneda: v.toLocaleString("es-AR", { style: "currency", currency: "ARS" }),
  numero: v.toLocaleString("es-AR"),
}));
const destino = new URL("../../backend/testdata/golden/formato/numeros.json", import.meta.url);
writeFileSync(destino, JSON.stringify(casos) + "\n");
console.log(`${casos.length} números en ${destino.pathname}`);
