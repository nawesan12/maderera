import { describe, expect, it } from "vitest";
import {
  cargoPorCorte,
  cargoPorTapacanto,
  metrosDeTapacanto,
  tarifaDeCorte,
  type TarifaDeCorte,
} from "@/lib/cortes/tarifa";

const PROFESIONAL = "11111111-1111-1111-1111-111111111111";
const OTRA = "22222222-2222-2222-2222-222222222222";

/** Las cuatro filas del brief. */
const TARIFAS: TarifaDeCorte[] = [
  { material: "Placas", priceListId: null, precioPorPasada: 1200, precioPorMetroCanto: 800 },
  { material: "Tableros de madera", priceListId: null, precioPorPasada: 1400, precioPorMetroCanto: 0 },
  { material: "Placas", priceListId: PROFESIONAL, precioPorPasada: 996, precioPorMetroCanto: 650 },
  { material: "Tableros de madera", priceListId: PROFESIONAL, precioPorPasada: 1162, precioPorMetroCanto: 0 },
];

describe("tarifaDeCorte", () => {
  it("al público, el precio de público", () => {
    expect(tarifaDeCorte(TARIFAS, "Placas", null)?.precioPorPasada).toBe(1200);
    expect(tarifaDeCorte(TARIFAS, "Tableros de madera", null)?.precioPorPasada).toBe(1400);
  });

  it("al mayorista, el suyo", () => {
    expect(tarifaDeCorte(TARIFAS, "Placas", PROFESIONAL)?.precioPorPasada).toBe(996);
  });

  it("una lista sin tarifa propia cae a la general", () => {
    // Igual que el precio del catálogo: quedarse sin tarifa significaría no
    // cobrar el corte.
    expect(tarifaDeCorte(TARIFAS, "Placas", OTRA)?.precioPorPasada).toBe(1200);
  });

  it("no distingue tildes ni mayúsculas", () => {
    // El material se tipea a mano en la orden de corte.
    expect(tarifaDeCorte(TARIFAS, "TABLEROS DE MADERA", null)?.precioPorPasada).toBe(1400);
  });

  it("un material sin tarifa no devuelve nada", () => {
    expect(tarifaDeCorte(TARIFAS, "Fenólico", null)).toBeNull();
  });
});

describe("cargoPorCorte", () => {
  it("cobra por pasada", () => {
    expect(cargoPorCorte(TARIFAS[0], 7)).toBe(8400);
  });

  it("sin pasadas medidas no cobra nada", () => {
    // Cero es "todavía no se optimizó", no "sale gratis": cobrar un mínimo
    // inventado sería peor que no cobrar.
    expect(cargoPorCorte(TARIFAS[0], 0)).toBe(0);
  });

  it("sin tarifa cargada no cobra nada", () => {
    expect(cargoPorCorte(null, 7)).toBe(0);
  });

  it("no cobra media pasada", () => {
    expect(cargoPorCorte(TARIFAS[0], 3.9)).toBe(3600);
  });
});

describe("metrosDeTapacanto", () => {
  it("la cuenta de la planilla del taller", () => {
    // El ejemplo de la propia planilla: tres piezas de 2000×100 con dos cantos
    // al largo y uno al ancho → 3 × (2×2000 + 1×100) = 12.300 mm.
    expect(
      metrosDeTapacanto([
        { largoMm: 2000, anchoMm: 100, cantidad: 3, cantoLargo: 2, cantoAncho: 1 },
      ]),
    ).toBe(12.3);
  });

  it("una pieza sin canto no suma metros", () => {
    expect(
      metrosDeTapacanto([
        { largoMm: 200, anchoMm: 100, cantidad: 1, cantoLargo: 0, cantoAncho: 0 },
      ]),
    ).toBe(0);
  });

  it("un canto fuera de rango se acota, no se multiplica", () => {
    // Un 5 tipeado no son cinco lados: la pieza tiene dos.
    expect(
      metrosDeTapacanto([
        { largoMm: 1000, anchoMm: 500, cantidad: 1, cantoLargo: 5, cantoAncho: -1 },
      ]),
    ).toBe(2);
  });
});

describe("cargoPorTapacanto", () => {
  it("cobra el metro lineal a la tarifa del material y la lista", () => {
    expect(cargoPorTapacanto(TARIFAS[0], 12.3)).toBe(9840);
    expect(cargoPorTapacanto(TARIFAS[2], 12.3)).toBe(7995);
  });

  it("un material sin precio de canto no cobra el pegado", () => {
    expect(cargoPorTapacanto(TARIFAS[1], 12.3)).toBe(0);
  });

  it("sin metros no hay cargo", () => {
    expect(cargoPorTapacanto(TARIFAS[0], 0)).toBe(0);
  });
});
