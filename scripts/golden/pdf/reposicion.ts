import { reposicionPdf } from "./ts/reposicion";
import type { ReporteDeReposicion } from "@/lib/dal/admin/reposicion";
import type { CasoPdf } from "../pdf";
import { azarCon } from "./_azar";

const { entero, palabras, azar, elegir } = azarCon(1202);

function caso(nombre: string, datos: ReporteDeReposicion): CasoPdf {
  return { nombre, datos, generar: () => reposicionPdf(datos) };
}

function filas(n: number): ReporteDeReposicion["filas"] {
  return Array.from({ length: n }, (_, i) => {
    const sugerido = azar() < 0.3 ? 0 : entero(500);
    return {
      variantId: `v${i}`,
      productId: `p${i}`,
      producto: palabras(1 + entero(8)),
      medida: palabras(entero(3)),
      sku: azar() < 0.2 ? null : `SKU-${i}`,
      unidad: "unidad",
      categoria: "Maderas",
      categoriaSlug: "maderas",
      rubro: azar() < 0.4 ? null : elegir(["Placas", "Ferretería", "", "Aberturas de álamo"]),
      disponibleCentral: azar() < 0.2 ? -entero(50) : entero(100000),
      disponibleAserradero: azar() < 0.5 ? 0 : Number((azar() * 300).toFixed(entero(4))),
      disponible: 0,
      vendido: entero(2000),
      sugerido,
      cobertura: null,
    } as unknown as ReporteDeReposicion["filas"][number];
  });
}

export const casos: CasoPdf[] = [
  caso("nada", { filas: [], porCategoria: [], diasDelPeriodo: 30, coberturaObjetivo: 30 }),
  caso("sin-sugeridos", { filas: filas(5).map((f) => ({ ...f, sugerido: 0 })), porCategoria: [], diasDelPeriodo: 60, coberturaObjetivo: 45 }),
  caso("corta", { filas: filas(12), porCategoria: [], diasDelPeriodo: 90, coberturaObjetivo: 7 }),
  caso("larga", { filas: filas(400), porCategoria: [], diasDelPeriodo: 30, coberturaObjetivo: 180 }),
];
