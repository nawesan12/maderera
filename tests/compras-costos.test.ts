import { describe, expect, it } from "vitest";
import { costoLejos, costoPropuesto } from "@/app/admin/compras/ordenes/costos";

// Mes simulado (H383, H297): el costo de la orden se propone en pesos y se
// marca cuando se aleja mucho del último.
describe("el costo de una orden de compra", () => {
  it("se propone redondeado a pesos y con coma", () => {
    expect(costoPropuesto("6619.58")).toBe("6.620");
    expect(costoPropuesto("54860.1")).toBe("54.860");
    expect(costoPropuesto(null)).toBe("");
  });
  it("se marca un 30 % por debajo o por encima del último", () => {
    expect(costoLejos(7800, 17050)).toBe(true);
    expect(costoLejos(4100, 6619)).toBe(true);
    expect(costoLejos(38000, 54860)).toBe(true);
    expect(costoLejos(23000, 17050)).toBe(true);
    expect(costoLejos(17500, 17050)).toBe(false);
    expect(costoLejos(100, null)).toBe(false);
  });
});
