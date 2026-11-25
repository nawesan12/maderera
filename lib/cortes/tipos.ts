/**
 * Los tipos del corte a medida, del contrato de la API de Go
 * (backend/api/cortes.yaml). El motor —plano, hoja de corte, PTX, lista para
 * el optimizador, presupuesto y calculadoras— vive en Go
 * (backend/internal/cortes); acá quedan solo las formas para las pantallas.
 */
import type { Esquemas } from "@/lib/api/tipos";

export type PlanoDeCorte = Esquemas["Plano"];
export type PlacaDelPlano = Esquemas["PlacaDelPlano"];
export type PiezaColocada = Esquemas["PiezaColocada"];
export type PiezaFijada = Esquemas["PiezaFijada"];
export type PiezaAcortar = Esquemas["PiezaAcortar"];
export type PresupuestoDeCorte = Esquemas["Presupuesto"];
export type TarifaDeCorte = Esquemas["TarifaDeCorte"];
export type HojaDeCorte = Esquemas["HojaDeCorte"];
export type PatronDeCorte = Esquemas["PatronDeCorte"];
export type OperacionDeCorte = Esquemas["OperacionDeCorte"];
export type PasoDeCorte = Esquemas["PasoDeCorte"];
export type Salida = Esquemas["Salida"];
export type Trozo = Esquemas["Trozo"];
export type PlacaCortable = Esquemas["PlacaCortable"];
export type ParametrosDeCalculo = Esquemas["ParametrosDeCalculo"];
export type CorteListado = Omit<Esquemas["CorteListado"], "createdAt"> & { createdAt: Date };

/** Desde qué medida un sobrante es retal y no viruta (MinimoAprovechable en Go). */
export const MINIMO_APROVECHABLE = 150;

/** Las columnas que se pueden poner en la lista para el optimizador. */
export const COLUMNAS = {
  largo: "Largo",
  ancho: "Ancho",
  cantidad: "Cantidad",
  material: "Material",
  etiqueta: "Etiqueta",
  veta: "Respeta veta",
  cantoLargo: "Canto largo",
  cantoAncho: "Canto ancho",
  numero: "N° de corte",
  cliente: "Cliente",
} as const;

export type ClaveColumna = keyof typeof COLUMNAS;

export interface ColumnaConfigurada {
  clave: ClaveColumna;
  encabezado: string;
}

/** Las columnas del formato común, el que se usa si no hay ninguno cargado. */
export const COLUMNAS_GENERICAS: ColumnaConfigurada[] = [
  { clave: "largo", encabezado: "Largo" },
  { clave: "ancho", encabezado: "Ancho" },
  { clave: "cantidad", encabezado: "Cantidad" },
  { clave: "material", encabezado: "Material" },
  { clave: "etiqueta", encabezado: "Etiqueta" },
  { clave: "veta", encabezado: "Veta" },
  { clave: "cantoLargo", encabezado: "Canto largo" },
  { clave: "cantoAncho", encabezado: "Canto ancho" },
];

/** Las medidas de placa de plaza, del brief (MEDIDAS_DE_PLACA). */
export const MEDIDAS_DE_PLACA = [
  { ancho: 1830, largo: 2750, usos: "Melamina, enchapados y MDF" },
  { ancho: 1830, largo: 2600, usos: "Melamina, enchapados, Fibro Plus y MDF" },
  { ancho: 1220, largo: 2440, usos: "Fenólicos, OSB y tableros de madera" },
  { ancho: 1220, largo: 3050, usos: "Tableros de madera" },
] as const;

/** Lo que se come la sierra en cada pasada, del brief. */
export const ANCHO_DE_SIERRA_MM = 5;
