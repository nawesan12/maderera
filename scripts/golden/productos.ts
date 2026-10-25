/**
 * Golden de la ficha de producto (lib/validation/product.ts, lib/unidades.ts):
 * qué contesta productoSchema para cada formulario —el primer error con su
 * campo, o los datos ya transformados—, formatearCantidad y generarSlug. El Go
 * (internal/productos) tiene que dar lo mismo.
 *
 *   npx tsx scripts/golden/productos.ts
 */
import { writeFileSync } from "node:fs";
import { generarSlug, productoSchema } from "../../lib/validation/product";
import { cantidadDeStock, formatearCantidad } from "../../lib/unidades";

const CAT = "8f2b5c1e-1d2a-4c3b-9a8e-111111111111";
const VAR = "8f2b5c1e-1d2a-4c3b-9a8e-222222222222";
const SUB = "8f2b5c1e-1d2a-4c3b-9a8e-333333333333";

const variante = {
  sku: "FEN18",
  label: "18 mm",
  largoMm: "2440",
  anchoMm: "1220",
  espesorMm: "18",
  material: "",
  color: "",
  terminacion: "",
  calidad: "",
  precioGeneral: "84500",
  precioProfesional: "",
  stockCentral: "3",
  stockAserradero: "0",
  minCentral: "1",
  minAserradero: "0",
};

// Lo que arma parsearFormulario en app/admin/productos/actions.ts.
const base = {
  name: "Fenólico",
  slug: "fenolico",
  categoryId: CAT,
  description: "",
  unit: "placa",
  formaDeVenta: "entera",
  precioMediaPct: "50",
  alicuotaIva: "21",
  featured: false,
  aPedido: false,
  active: true,
  imagen: "",
  variantes: [variante],
};

type Caso = Record<string, unknown>;
const con = (cambios: Caso): Caso => ({ ...base, ...cambios });
const conVariante = (cambios: Caso, extra: Caso = {}): Caso => ({ ...base, ...extra, variantes: [{ ...variante, ...cambios }] });

const casos: Caso[] = [
  base,
  con({ id: VAR, subcategoryId: SUB, subcategory: "  Fenólicos ", brand: " Faplac ", imputacion: "Placas", recargoElaboracionPct: "12.5", featured: true, aPedido: true, active: false }),
  con({ name: " F " }),
  con({ name: "x".repeat(161) }),
  con({ slug: "Fenólico 18" }),
  con({ slug: "a" }),
  con({ slug: "fenolico--18" }),
  con({ categoryId: "" }),
  con({ categoryId: "no-es-uuid" }),
  con({ subcategoryId: "" }),
  con({ subcategoryId: "xx" }),
  con({ id: "no-uuid" }),
  con({ description: "d".repeat(2001) }),
  con({ unit: "barril" }),
  con({ unit: "unidad", formaDeVenta: "metro_cuadrado" }),
  con({ formaDeVenta: "por-kilo" }),
  con({ precioMediaPct: "0" }),
  con({ precioMediaPct: "" }),
  con({ precioMediaPct: "101" }),
  con({ precioMediaPct: "62.5" }),
  con({ precioMediaPct: "abc" }),
  con({ alicuotaIva: "10.5" }),
  con({ alicuotaIva: "27" }),
  con({ recargoElaboracionPct: "-1" }),
  con({ recargoElaboracionPct: "501" }),
  con({ recargoElaboracionPct: "0" }),
  con({ recargoElaboracionPct: "abc" }),
  con({ imagen: "foto.png" }),
  con({ imagen: "https://x.com/a.png" }),
  con({ imagen: "  " }),
  con({ variantes: [] }),
  con({ name: "", slug: "" }),
  conVariante({ sku: "F" }),
  conVariante({ sku: " " }),
  conVariante({ label: "" }),
  conVariante({ largoMm: "" , anchoMm: " ", espesorMm: "" }),
  conVariante({ largoMm: "-5" }),
  conVariante({ largoMm: "abc" }),
  conVariante({ largoMm: "1e3" }),
  conVariante({ precioGeneral: "84.500,50" }),
  conVariante({ precioGeneral: "84500,5" }),
  conVariante({ precioGeneral: "-1" }),
  conVariante({ precioGeneral: " 1200 " }),
  conVariante({ stockCentral: "2,5" }),
  conVariante({ stockCentral: "2.5" }, { unit: "metro_lineal" }),
  conVariante({ stockCentral: "2,12345" }, { unit: "metro_lineal" }),
  conVariante({ stockCentral: "" }),
  conVariante({ stockCentral: "-3" }),
  conVariante({ minAserradero: "0.5" }),
  conVariante({ largoMm: "", anchoMm: "" }, { formaDeVenta: "metro_cuadrado" }),
  conVariante({ largoMm: "2440", anchoMm: "" , label: "" }, { formaDeVenta: "metro_cuadrado" }),
  conVariante({ largoMm: "2440", anchoMm: "1220" }, { formaDeVenta: "metro_cuadrado" }),
  conVariante({ id: "malo" }),
  conVariante({ material: "m".repeat(81) }),
  conVariante({ material: "  Pino  ", color: "Blanco" }),
  { ...base, variantes: [variante, { ...variante, sku: "X", label: "" }, { ...variante, stockCentral: "1,5" }] },
  { ...base, unit: "kg", variantes: [{ ...variante, stockCentral: "0,333" }] },
];

const validacion = casos.map((entrada) => {
  const r = productoSchema.safeParse(entrada);
  if (!r.success) {
    const primero = r.error.issues[0];
    return { entrada, error: primero?.message ?? "Revisá los datos del formulario.", campo: primero?.path.join(".") ?? "" };
  }
  return { entrada, datos: r.data };
});

const cantidades = [0, 1, 1.5, 2.25, 0.3333333, 1234.5678, 1000000, -2.5, 0.0005, 0.0004, 1.0005, 12.3456, 999999.9995].map(
  (v) => ({ v, redondeado: cantidadDeStock(v), texto: formatearCantidad(v) }),
);

const slugs = ["Fenólico 18 mm", "  Ñandubay  ", "MDF/Blanco -- 2,5", "Árbol & Co.", "", "---", "Placa 18\"x2"].map((t) => ({
  t,
  slug: generarSlug(t),
}));

const destino = new URL("../../backend/testdata/golden/productos/ficha.json", import.meta.url);
writeFileSync(destino, JSON.stringify({ validacion, cantidades, slugs }, null, 1) + "\n");
console.log(`${validacion.length} formularios, ${cantidades.length} cantidades y ${slugs.length} slugs en ${destino.pathname}`);
