/**
 * Golden de las cuentas de precios del panel: el ajuste masivo (`ajustar` y
 * `toFixed(2)` de app/admin/precios/actions.ts), la brecha entre listas
 * (lib/dal/admin/precios.ts), parsearImporte (lib/formato.ts) y lo que
 * contestaban los esquemas de zod del ajuste y de las listas derivadas. El Go
 * (internal/precios) tiene que dar lo mismo, bit a bit.
 *
 *   npx tsx scripts/golden/precios.ts
 */
import { writeFileSync } from "node:fs";
import { z } from "zod";
import { parsearImporte } from "../../lib/formato";

// Copiada tal cual de app/admin/precios/actions.ts (git 5dea0ec), que no la
// exportaba: lo que importa es que la corra JavaScript.
function ajustar(base: number, factor: number, modo: string): number {
  const conAjuste = Math.round(base * factor * 100) / 100;
  if (modo === "decena") return Math.ceil(conAjuste / 10) * 10;
  if (modo === "centena") return Math.ceil(conAjuste / 100) * 100;
  if (modo === "mil") return Math.ceil(conAjuste / 1000) * 1000;
  return conAjuste;
}

// Los esquemas, copiados de las acciones.
const ajusteSchema = z.object({
  porcentaje: z.coerce
    .number()
    .min(-90, "No se puede bajar más de 90%.")
    .max(500, "Un aumento mayor a 500% seguramente sea un error de tipeo.")
    .refine((v) => v !== 0, "Poné un porcentaje distinto de cero."),
});
const listaSchema = z.object({ porcentaje: z.coerce.number().min(-50).max(50).nullable() });

// Un generador con semilla, para que el golden no cambie de una corrida a otra.
let semilla = 20261025;
const azar = () => {
  semilla = (semilla * 1103515245 + 12345) % 2 ** 31;
  return semilla / 2 ** 31;
};

const modos = ["ninguno", "decena", "centena", "mil"];
const ajustes: { base: number; porcentaje: number; modo: string; resultado: string }[] = [];
const bases = [0.01, 0.5, 1, 9.99, 10, 99.995, 100, 1234.565, 84500, 84500.5, 123456.785, 999999.99, 0.125, 2.675, 1.005];
const porcentajes = [-90, -50, -33.33, -10, -0.5, 0.1, 1, 5, 7.5, 10, 12.34, 15, 21, 33.333, 50, 100, 500];
for (const base of bases) for (const porcentaje of porcentajes) for (const modo of modos) {
  ajustes.push({ base, porcentaje, modo, resultado: ajustar(base, 1 + porcentaje / 100, modo).toFixed(2) });
}
for (let i = 0; i < 4000; i++) {
  const base = Math.round(azar() * 1e7) / 100;
  const porcentaje = Math.round((azar() * 590 - 90) * 100) / 100 || 1;
  const modo = modos[Math.floor(azar() * 4)];
  ajustes.push({ base, porcentaje, modo, resultado: ajustar(base, 1 + porcentaje / 100, modo).toFixed(2) });
}

// El costo con elaboración: Math.round(costo * (1 + recargo/100) * 100) / 100.
const costos: { costo: number; recargo: number | null; resultado: number }[] = [];
for (let i = 0; i < 1000; i++) {
  const costo = Math.round(azar() * 1e7) / 100;
  const recargo = i % 5 === 0 ? null : Math.round(azar() * 5000) / 100;
  costos.push({ costo, recargo, resultado: Math.round(costo * (1 + Number(recargo ?? 0) / 100) * 100) / 100 });
}

const fijos = [0, 0.005, 0.015, 0.125, 1.005, 1.255, 2.675, 10.235, 84500, 84500.5, 1e21, 123.456, -1.005, 0.1 + 0.2];
const toFixed = fijos.map((v) => ({ v, r: v.toFixed(2) }));

const brechas: { g: number; p: number; r: number | null }[] = [];
for (let i = 0; i < 1000; i++) {
  const g = Math.round(azar() * 1e7) / 100;
  const p = i % 7 === 0 ? 0 : Math.round(g * (0.5 + azar() * 0.6) * 100) / 100;
  brechas.push({ g, p, r: g > 0 && p > 0 ? Math.round((1 - p / g) * 1000) / 10 : null });
}

const importes = ["", "  ", "1234", "1.234", "1.234,56", "1234,5", "12.34", "1.234.567", "1,234.56", "-1.234", "$ 1.234", "abc", "0,5", "10.5", "1.2345", " 84 500 "].map(
  (t) => ({ t, r: String(parsearImporte(t)) }),
);

const errorDe = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.success ? null : (r.error?.issues[0]?.message ?? "");
const porcentajesAjuste = ["10", "", "0", "-91", "-90", "500", "501", "abc", "12,5", "12.5", " 7 "].map((t) => {
  const r = ajusteSchema.safeParse({ porcentaje: t });
  return { t, error: errorDe(r), valor: r.success ? r.data.porcentaje : null };
});
const porcentajesLista = ["-5", "-50", "-50.01", "50", "51", "abc", "0", "12.345"].map((t) => {
  const r = listaSchema.safeParse({ porcentaje: t });
  return { t, error: errorDe(r), valor: r.success ? r.data.porcentaje : null, guardado: r.success && r.data.porcentaje !== null ? r.data.porcentaje.toFixed(2) : null };
});

const destino = new URL("../../backend/testdata/golden/precios/cuentas.json", import.meta.url);
writeFileSync(
  destino,
  JSON.stringify({ ajustes, costos, toFixed, brechas, importes, porcentajesAjuste, porcentajesLista }, null, 0) + "\n",
);
console.log(`${ajustes.length} ajustes, ${costos.length} costos, ${brechas.length} brechas en ${destino.pathname}`);
