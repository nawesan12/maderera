import { hojaDeCortePdf, type CorteParaHoja } from "@/lib/pdf/hoja-de-corte";
import { armarHojaDeCorte } from "../../../bench/tanda11/ts/secuencia";
import type { CasoPdf } from "../pdf";
import { despieces, plano } from "./_cortes";

const corte = (i: number): CorteParaHoja => ({
  numero: `C-${String(2000 + i * 41).padStart(6, "0")}`,
  cliente: i % 2 ? "Carpintería Ñandú — Arq. Méndez" : "Juan Pérez",
  material: i % 3 ? "Melamina blanca 18 mm “Faplac”" : "MDF crudo 5,5 mm",
  deQueSale: i % 2 ? "Placa entera" : "Media placa",
  createdAt: new Date(Date.UTC(2026, (i * 5) % 12, 28 - i, 23 - i, 59)),
});

export const casos: CasoPdf[] = despieces(1221).map((d, i) => {
  const datos = { corte: corte(i), hoja: armarHojaDeCorte(plano(d)) };
  return {
    nombre: d.nombre,
    datos,
    generar: () => hojaDeCortePdf(datos.corte, datos.hoja as never),
  };
});
