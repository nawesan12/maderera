import { describe, expect, it } from "vitest";
import { cargoPorCorte, tarifaDeCorte, type TarifaDeCorte } from "@/lib/cortes/tarifa";

const PROFESIONAL = "11111111-1111-1111-1111-111111111111";
const OTRA = "22222222-2222-2222-2222-222222222222";

/** Las cuatro filas del brief. */
const TARIFAS: TarifaDeCorte[] = [
  { material: "Placas", priceListId: null, precioPorPasada: 1200 },
  { material: "Tableros de madera", priceListId: null, precioPorPasada: 1400 },
  { material: "Placas", priceListId: PROFESIONAL, precioPorPasada: 996 },
  { material: "Tableros de madera", priceListId: PROFESIONAL, precioPorPasada: 1162 },
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
