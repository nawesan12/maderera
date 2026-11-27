import { describe, expect, it } from "vitest";
import { diaCorto } from "@/lib/formato";
import { estadoEnSucursal, pideReponer } from "@/lib/stock-ajuste";

describe("la fecha prometida de una orden en Stock (M3S2-025)", () => {
  it("un día guardado a medianoche UTC es ese día, en cualquier zona", () => {
    expect(diaCorto.format(new Date("2026-11-30T00:00:00Z"))).toBe("30/11");
  });
  it("un instante se lee en hora argentina", () => {
    expect(diaCorto.format(new Date("2026-12-01T01:30:00Z"))).toBe("30/11");
  });
});

describe("la sucursal que pide reposición (M2S1-028)", () => {
  it("es la misma regla que Go: en su mínimo o en negativo", () => {
    expect(pideReponer(0, 50)).toBe(true);
    expect(pideReponer(200, 50)).toBe(false);
    expect(pideReponer(-3, 0)).toBe(true);
    expect(pideReponer(0, 0)).toBe(false);
    expect(pideReponer(50, 50)).toBe(true);
  });
  it("una sucursal en cero sin mínimo no pide, aunque diga «Sin stock»", () => {
    expect(estadoEnSucursal(0, 0)).toBe("sin-stock");
    expect(pideReponer(0, 0)).toBe(false);
  });
});
