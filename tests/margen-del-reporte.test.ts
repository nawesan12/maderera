import { describe, expect, it } from "vitest";
import { margenDelRenglon } from "@/lib/reportes-cortes";

// M2S1-039 (mes 23): el color del margen de un producto con costo. No se
// podía ver en la prueba porque ningún producto quedaba debajo del 5 %.
describe("margenDelRenglon", () => {
  it("pinta el margen sano, el bajo y el negativo", () => {
    // MDF de la prueba: 135.333,75 − 107.820,45 = 27.513,30 (20,3 %).
    expect(margenDelRenglon(135333.75, 107820.45)).toMatchObject({ color: "text-saldo-favor" });
    expect(margenDelRenglon(135333.75, 107820.45).margen).toBeCloseTo(27513.3, 2);
    expect(margenDelRenglon(100000, 96000)).toMatchObject({ color: "estado-espera", pct: 4 });
    expect(margenDelRenglon(100000, 95000).color).toBe("text-saldo-favor");
    expect(margenDelRenglon(100000, 101000).color).toBe("text-saldo-debe");
    expect(margenDelRenglon(0, 500)).toMatchObject({ pct: null, color: "text-saldo-debe" });
  });
});
