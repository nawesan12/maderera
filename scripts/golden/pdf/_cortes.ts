/**
 * Planos de corte de verdad para los golden de corte y hoja-de-corte: el
 * despiece sale al azar (con semilla) y el plano lo calcula el optimizador
 * real de lib/cortes.
 */
import { calcularPlanoDeCorte, type PiezaAcortar, type PlanoDeCorte } from "../../../bench/tanda11/ts/plano";
import { azarCon } from "./_azar";

export interface Despiece {
  nombre: string;
  piezas: PiezaAcortar[];
  placaLargo: number;
  placaAncho: number;
  anchoSierra: number;
  busqueda?: boolean;
}

export function despieces(semilla: number): Despiece[] {
  const { entero, azar, palabras, elegir } = azarCon(semilla);
  const pieza = (maxL: number, maxA: number): PiezaAcortar => ({
    largoMm: 30 + entero(maxL),
    anchoMm: 30 + entero(maxA),
    cantidad: 1 + entero(4),
    respetaVeta: azar() < 0.3 ? 1 : 0,
    etiqueta: azar() < 0.5 ? null : palabras(1 + entero(4)),
  });
  return [
    {
      nombre: "una-pieza",
      piezas: [{ largoMm: 600, anchoMm: 400, cantidad: 1, respetaVeta: 0, etiqueta: "Estante “alacena” — cocina" }],
      placaLargo: 2750,
      placaAncho: 1830,
      anchoSierra: 4.4,
    },
    {
      nombre: "placa-entera",
      piezas: [{ largoMm: 2750, anchoMm: 1830, cantidad: 1, respetaVeta: 1, etiqueta: null }],
      placaLargo: 2750,
      placaAncho: 1830,
      anchoSierra: 3.25,
    },
    {
      nombre: "no-entran",
      piezas: [
        { largoMm: 3000, anchoMm: 500, cantidad: 2, respetaVeta: 1, etiqueta: "lateral" },
        { largoMm: 2000, anchoMm: 1900, cantidad: 1, respetaVeta: 0, etiqueta: null },
        { largoMm: 700, anchoMm: 350, cantidad: 3, respetaVeta: 0, etiqueta: "😀 cajón" },
      ],
      placaLargo: 2600,
      placaAncho: 1830,
      anchoSierra: 4.4,
    },
    {
      nombre: "mueble",
      piezas: Array.from({ length: 9 }, () => pieza(1200, 600)),
      placaLargo: 2750,
      placaAncho: 1830,
      anchoSierra: 4.4,
    },
    {
      nombre: "diminutas",
      piezas: Array.from({ length: 6 }, () => ({ ...pieza(60, 40), cantidad: 8 + entero(20) })),
      placaLargo: 1830,
      placaAncho: 1375,
      anchoSierra: 2.75,
    },
    {
      nombre: "muchas-placas",
      piezas: Array.from({ length: 30 }, () => ({ ...pieza(1500, 900), etiqueta: elegir([null, "Puerta placard de pino Paraná cepillado con canto ABS", "x"]) })),
      placaLargo: 2440,
      placaAncho: 1220,
      anchoSierra: 3.8,
      busqueda: false,
    },
  ];
}

export function plano(d: Despiece): PlanoDeCorte {
  return calcularPlanoDeCorte({
    piezas: d.piezas,
    placaLargo: d.placaLargo,
    placaAncho: d.placaAncho,
    anchoSierra: d.anchoSierra,
    busqueda: d.busqueda,
  });
}
