import { describe, expect, it } from "vitest";
import { medidaPrincipal } from "@/lib/catalogo/medida";

describe("medida principal de la tarjeta", () => {
  it("sin medidas no hay nada", () => {
    expect(medidaPrincipal([])).toBeNull();
    expect(medidaPrincipal(["", "  ", null, undefined])).toBeNull();
  });

  it("una sola, sin contador", () => {
    expect(medidaPrincipal(["1220 × 2440 mm — 18 mm"])).toEqual({
      texto: "1220 × 2440 mm — 18 mm",
      partes: ["1220 × 2440 mm", "18 mm"],
      resto: 0,
    });
  });

  it("varias: la primera y el resto como contador", () => {
    const m = medidaPrincipal(["1220 × 2440 mm — 18 mm", "1220 × 2440 mm — 15 mm", "1830 × 2600 mm — 18 mm"]);
    expect(m?.texto).toBe("1220 × 2440 mm — 18 mm");
    expect(m?.resto).toBe(2);
  });

  it("las vacías no cuentan y los espacios de más se limpian", () => {
    const m = medidaPrincipal(["  ", "  3,05 m  ", "", "3,66 m"]);
    expect(m).toEqual({ texto: "3,05 m", partes: ["3,05 m"], resto: 1 });
  });

  it("una etiqueta que no es medida se muestra igual", () => {
    expect(medidaPrincipal(["Rojo teja"])?.partes).toEqual(["Rojo teja"]);
    expect(medidaPrincipal(["A medida — consultar"])?.partes).toEqual(["A medida", "consultar"]);
  });

  it("no parte en un guion pegado ni en el «×»", () => {
    expect(medidaPrincipal(["2x4 — 3,05 m"])?.partes).toEqual(["2x4", "3,05 m"]);
    expect(medidaPrincipal(["finger-joint 70 mm"])?.partes).toEqual(["finger-joint 70 mm"]);
  });
});
