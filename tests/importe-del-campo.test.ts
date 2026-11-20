import { describe, expect, it } from "vitest";
import { importeDelCampo, importeParaElCampo } from "@/lib/formato";

/*
 * Los campos de plata del panel y del mostrador (gastos, pagos a proveedores,
 * facturas de compra, notas, fondo de caja, cuenta del proveedor, vuelto):
 * `type="text"` con `inputMode="decimal"`, leídos con `importeDelCampo` y
 * precargados con `importeParaElCampo`. Con `type="number"` y `Number()`,
 * «15.000» se guardaba como $15 (comité final, M13).
 */
describe("importeDelCampo", () => {
  it.each([
    ["15.000", 15000],
    ["1.234,56", 1234.56],
    ["1234,56", 1234.56],
    ["1234.56", 1234.56],
    ["1.500.000", 1500000],
    ["250", 250],
    [" 15.000 ", 15000],
    ["0,5", 0.5],
  ])("«%s» es %d", (texto, n) => {
    expect(importeDelCampo(texto)).toBe(n);
  });

  it("vacío o ilegible es cero", () => {
    expect(importeDelCampo("")).toBe(0);
    expect(importeDelCampo(undefined)).toBe(0);
    expect(importeDelCampo("abc")).toBe(0);
  });
});

describe("importeParaElCampo", () => {
  it.each([
    [15000, "15.000"],
    [1234.56, "1.234,56"],
    [1234.5, "1.234,5"],
    [0.1 + 0.2, "0,3"],
    ["19200.0000", "19.200"],
  ])("%s se precarga «%s»", (n, texto) => {
    expect(importeParaElCampo(n)).toBe(texto);
  });

  it("se lee de vuelta igual", () => {
    for (const n of [15000, 1234.56, 0.5, 999.99, 1500000, 12.3, 100]) {
      expect(importeDelCampo(importeParaElCampo(n))).toBe(n);
    }
  });

  it("nada es vacío", () => {
    expect(importeParaElCampo(null)).toBe("");
    expect(importeParaElCampo("")).toBe("");
  });
});
