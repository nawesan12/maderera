/**
 * Golden de la lógica pura de la tanda 4 (clientes, cuenta corriente, cheques
 * y cobros): las partes de un cobro (revisar, total, centavos, importe en
 * letras, leerPartes), los cheques (número, transiciones, efecto en la
 * cuenta), el aging y la prioridad de cobranza, y el CUIT y el documento.
 * El Go (internal/cobros, internal/cuit, internal/clientes) tiene que dar lo
 * mismo.
 *
 *   npx tsx scripts/golden/cuentas.ts
 */
import { writeFileSync } from "node:fs";
import { aCentavos, importeEnLetras, revisarPartes, totalDePartes, type ParteDeCobro } from "../../lib/cobros/partes";
import { leerPartes } from "./originales/tanda6/leer";
import { efectoEnLaCuenta, puedePasar, TRANSICIONES, type EstadoDeCheque } from "../../lib/cheques/estados";
import { nombreDelCheque, normalizarNumeroDeCheque, revisarNumeroDeCheque } from "../../lib/cheques/numero";
import { calcularAging } from "../../lib/cuenta-corriente/aging";
import { prioridadDeCobranza } from "../../lib/cuenta-corriente/prioridad";
import { cuitValido, digitoVerificador, dniValido, formatearCuitLargo, soloDigitos, variantesDeCuit } from "../../lib/cuit";
import { leerDocumento, precargaDelAlta, sugerirCondicionIva } from "../../lib/clientes/documento";

let semilla = 20261029;
const azar = () => {
  semilla = (semilla * 1103515245 + 12345) % 2 ** 31;
  return semilla / 2 ** 31;
};
const entero = (n: number) => Math.floor(azar() * n);

// --- partes ---
const medios = ["efectivo", "transferencia", "deposito", "cheque", "echeq", "tarjeta_debito", "tarjeta_credito", "mercado_pago", "retencion"] as const;
const U = "8f2b5c1e-1d2a-4c3b-9a8e-111111111111";
const partesFijas: { partes: ParteDeCobro[]; circuito?: "blanco" | "negro" }[] = [
  { partes: [] },
  { partes: [{ medio: "efectivo", importe: 0 }] },
  { partes: [{ medio: "efectivo", importe: -5 }] },
  { partes: [{ medio: "efectivo", importe: NaN }] },
  { partes: [{ medio: "efectivo", importe: 1000.555 }, { medio: "transferencia", importe: 0.1 }] },
  { partes: [{ medio: "cheque", importe: 100 }] },
  { partes: [{ medio: "cheque", importe: 100, cheque: { numero: "12", banco: "Nación", fechaPago: new Date("2026-11-01T12:00:00") } }] },
  { partes: [{ medio: "cheque", importe: 100, cheque: { numero: "1234-5678", banco: " ", fechaPago: new Date("2026-11-01T12:00:00") } }] },
  { partes: [{ medio: "cheque", importe: 100, cheque: { numero: "123456789012345678901", banco: "Nación", fechaPago: new Date("2026-11-01T12:00:00") } }] },
  { partes: [{ medio: "cheque", importe: 100, cheque: { numero: "00123456", banco: "Nación", fechaPago: new Date("x") } }] },
  { partes: [{ medio: "echeq", importe: 100, cheque: { numero: "00123456", banco: "Galicia", fechaPago: new Date("2026-11-01T12:00:00") } }], circuito: "negro" },
  { partes: [{ medio: "efectivo", importe: 10, chequeId: U }] },
  { partes: [{ medio: "cheque", importe: 10, chequeId: U }, { medio: "cheque", importe: 10, chequeId: U }] },
  { partes: [{ medio: "efectivo", importe: 10 }, { medio: "cheque", importe: 10 }] },
];
const partes = partesFijas.map(({ partes, circuito }) => ({
  partes: partes.map((p) => ({ ...p, importe: Number.isNaN(p.importe) ? "NaN" : p.importe, cheque: p.cheque ? { ...p.cheque, fechaPago: Number.isNaN(p.cheque.fechaPago.getTime()) ? "invalida" : "2026-11-01" } : p.cheque })),
  circuito: circuito ?? null,
  problema: revisarPartes(partes, circuito),
  total: partes.length ? totalDePartes(partes.filter((p) => Number.isFinite(p.importe))) : 0,
}));
const totales: { importes: number[]; total: number }[] = [];
for (let i = 0; i < 3000; i++) {
  const importes = Array.from({ length: 1 + entero(5) }, () => Math.round(azar() * 1e8) / 1000);
  totales.push({ importes, total: totalDePartes(importes.map((importe) => ({ importe }))) });
}
const centavos = [0.005, 0.015, 1.005, 2.675, 1234.565, 0.1 + 0.2, -1.005, 99999999.995].map((v) => ({ v, r: aCentavos(v) }));
const letras: { v: number; r: string }[] = [0, 1, 21, 100, 101, 1000, 1001, 21000, 100000, 1000000, 1000001, 21021021, 999999999.99, 84500.5, 0.07, 31, 71, 200, 115, 1e9]
  .map((v) => ({ v, r: importeEnLetras(v) }));
for (let i = 0; i < 2000; i++) {
  const v = Math.round(azar() * 1e11) / 100;
  letras.push({ v, r: importeEnLetras(v) });
}

// --- leerPartes (el JSON del formulario) ---
const crudos: unknown[] = [
  "no es json",
  "[]",
  JSON.stringify([{ medio: "efectivo", importe: "1.234,56" }]),
  JSON.stringify([{ medio: "billetera", importe: "1" }]),
  JSON.stringify([{ medio: "cheque", importe: "1000", cheque: { numero: " 0012 3456 ", banco: " Nación ", fechaPago: "2026-11-01" } }]),
  JSON.stringify([{ medio: "cheque", importe: "1000", cheque: { numero: "1", banco: "x", fechaPago: "01/11/2026" } }]),
  JSON.stringify([{ medio: "efectivo", importe: "10", referencia: "  ", chequeId: "" }]),
  JSON.stringify([{ medio: "efectivo", importe: "10", chequeId: "no-uuid" }]),
  JSON.stringify(Array.from({ length: 21 }, () => ({ medio: "efectivo", importe: "1" }))),
  JSON.stringify([{ medio: "transferencia", importe: "abc", referencia: "x".repeat(121) }]),
  JSON.stringify([{ medio: "transferencia", importe: "250.000", referencia: "op 123" }]),
];
const lecturas = crudos.map((crudo) => {
  const r = leerPartes(crudo);
  if ("error" in r) return { crudo, error: r.error };
  return {
    crudo,
    partes: r.partes.map((p) => ({ ...p, importe: Number.isNaN(p.importe) ? "NaN" : p.importe, cheque: p.cheque ? { ...p.cheque, fechaPago: p.cheque.fechaPago.toISOString() } : null })),
  };
});

// --- cheques ---
const estados = Object.keys(TRANSICIONES) as EstadoDeCheque[];
const transiciones = estados.flatMap((desde) => estados.map((hacia) => ({ desde, hacia, puede: puedePasar(desde, hacia), efecto: efectoEnLaCuenta(desde, hacia) })));
const numeros = ["", "12", "1234", "00123456", "0012-3456 7", "a1b2c3d4", "123456789012345678901", "12345678901234567890"].map((t) => ({
  t,
  normal: normalizarNumeroDeCheque(t),
  problema: revisarNumeroDeCheque(t),
}));
const nombres = [
  { tipo: "fisico" as const, banco: "Nación", numero: "00123456" },
  { tipo: "echeq" as const, banco: "Galicia", numero: "1" },
  { tipo: null, banco: null, numero: "9" },
].map((c) => ({ c, r: nombreDelCheque(c) }));

// --- aging y prioridad ---
const hoy = new Date("2026-10-29T15:00:00Z");
const agings: { movimientos: { monto: number; fecha: string }[]; r: ReturnType<typeof calcularAging> }[] = [];
for (let i = 0; i < 1500; i++) {
  const movimientos = Array.from({ length: entero(12) }, () => {
    const dias = entero(200);
    const monto = (azar() < 0.6 ? 1 : -1) * Math.round(azar() * 5e7) / 100;
    return { monto, fecha: new Date(hoy.getTime() - dias * 86_400_000 - entero(86_400_000)).toISOString() };
  });
  agings.push({ movimientos, r: calcularAging(movimientos.map((m) => ({ monto: m.monto, fecha: new Date(m.fecha) })), hoy) });
}
const prioridades: { d: Parameters<typeof prioridadDeCobranza>[0]; r: ReturnType<typeof prioridadDeCobranza> }[] = [];
for (let i = 0; i < 1000; i++) {
  const d = {
    vencido: azar() < 0.2 ? 0 : Math.round(azar() * 1e7) / 100,
    diasDeLaMasVieja: azar() < 0.2 ? null : entero(300),
    diasCredito: [0, 15, 30, 60][entero(4)],
    bloqueada: azar() < 0.1,
  };
  prioridades.push({ d, r: prioridadDeCobranza(d) });
}

// --- CUIT y documento ---
const cuits: string[] = ["", "30589445259", "30-58944525-9", "20123456786", "20-12345678-6", "27000000000", "11111111111", "30589445258", "2012345678", "99123456785", "23-22222222-9", "33693450239", "34999032089"];
for (let i = 0; i < 2000; i++) {
  const pref = ["20", "23", "24", "27", "30", "33", "34", "21", "99"][entero(9)];
  const cuerpo = String(entero(1e8)).padStart(8, "0");
  const dv = azar() < 0.7 ? digitoVerificador(pref + cuerpo) : entero(10);
  cuits.push(pref + cuerpo + (dv ?? 0));
}
const cuit = cuits.map((c) => ({
  c,
  solo: soloDigitos(c),
  valido: cuitValido(c),
  largo: formatearCuitLargo(c),
  variantes: variantesDeCuit(c),
  dv: digitoVerificador(soloDigitos(c).slice(0, 10)),
}));
const dnis = ["", "1234567", "12345678", "123456789", "11111111", "12.345.678", "1111112"].map((d) => ({ d, valido: dniValido(d) }));
const documentos = ["", "30589445259", "30-58944525-9", "30589445258", "20123456786", "12345678", "11111111", "123", "12.345.678", "abc"].map((t) => {
  const r = leerDocumento(t);
  return { t, r, iva: "error" in r ? null : sugerirCondicionIva(r) };
});
const precargas = ["Juan Pérez", "30589445259", "30-58944525-9", "12.345.678", "Corralón 2000", "  1234567  ", "123456", "20 12345678 6"].map((b) => ({ b, r: precargaDelAlta(b) }));

const destino = new URL("../../backend/testdata/golden/cuentas/logica.json", import.meta.url);
writeFileSync(
  destino,
  JSON.stringify({ partes, totales, centavos, letras, lecturas, transiciones, numeros, nombres, hoy: hoy.toISOString(), agings, prioridades, cuit, dnis, documentos, precargas }) + "\n",
);
console.log(`golden de la tanda 4 en ${destino.pathname}`);
