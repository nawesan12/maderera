import { cortePdf, type CorteParaPdf } from "@/lib/pdf/corte";
import type { CasoPdf } from "../pdf";
import { EMISOR, EMISOR_LARGO } from "./_azar";
import { despieces, plano } from "./_cortes";

const corte = (i: number): CorteParaPdf => ({
  numero: `C-${String(1000 + i * 37).padStart(6, "0")}`,
  cliente: i % 2 ? "Carpintería Ñandú — Arq. Méndez" : "Juan Pérez",
  material: i % 3 ? "Melamina blanca 18 mm “Faplac”" : "MDF crudo 5,5 mm",
  cantoDescripcion: i % 2 ? null : "ABS 22 × 0,45 blanco",
  deQueSale: i % 2 ? "Placa entera" : "Media placa (la mitad larga)",
  createdAt: new Date(Date.UTC(2026, i % 12, 1 + i, 2 + i, 7)),
  metrosCanto: i === 0 ? 0 : i * 12.345 + 0.005,
});

export const casos: CasoPdf[] = despieces(1220).map((d, i) => {
  const datos = { corte: corte(i), plano: plano(d), emisor: i % 2 ? EMISOR_LARGO : i === 0 ? null : EMISOR };
  return {
    nombre: d.nombre,
    datos,
    generar: () => cortePdf(datos.corte, datos.plano, datos.emisor),
  };
});
