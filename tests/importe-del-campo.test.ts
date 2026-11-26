import { describe, expect, it } from "vitest";
import { importeDelCampo, importeIlegible, importeParaElCampo } from "@/lib/formato";

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
    ["$ 420.000,50", 420000.5],
    ["$ 20.000", 20000],
    ["$20.000", 20000],
    ["ARS 15.000", 15000],
    ["44.992,56", 44992.56],
    ["1.2345", 1.2345],
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
    [1234.5, "1.234,50"],
    [0.1 + 0.2, "0,30"],
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

describe("importeIlegible", () => {
  it("vacío no es ilegible: es cero", () => {
    expect(importeIlegible("")).toBe(false);
    expect(importeIlegible("  ")).toBe(false);
    expect(importeIlegible(null)).toBe(false);
  });

  it.each(["abc", "12,5,3", "1.2.3,4,5", "$ abc"])("«%s» no se entiende", (t) => {
    expect(importeIlegible(t)).toBe(true);
  });

  it.each(["15.000", "$ 420.000,50", "0", "1234.56"])("«%s» se entiende", (t) => {
    expect(importeIlegible(t)).toBe(false);
  });
});

/*
 * Ningún campo de plata vuelve a `type="number"`: el navegador lee «15.000»
 * como 15. Se controla en los archivos que tuvieron el problema (comité del
 * 25/11): el precio a mano del mostrador, el costo de compras y recepciones,
 * la base de una retención y los mínimos de los regímenes.
 */
describe("los campos de plata no son type=number", () => {
  it.each([
    "app/admin/arca/retenciones/cargar.tsx",
    "app/admin/arca/retenciones/regimenes.tsx",
    "app/admin/recepciones/nueva/formulario.tsx",
    "app/admin/compras/ordenes/nueva/formulario.tsx",
    "app/admin/presupuestos/nuevo/formulario.tsx",
    "app/mostrador/alta-a-mano.tsx",
    "app/mostrador/lineas.tsx",
  ])("%s", async (archivo) => {
    const { readFileSync } = await import("node:fs");
    const texto = readFileSync(archivo, "utf8");
    // Cada `type="number"` que quede tiene que ser de una cantidad, días o
    // porcentaje, nunca de precio, costo, base, importe o mínimo.
    for (const m of texto.matchAll(/type="number"[\s\S]{0,240}?value=\{([^}]+)\}/g)) {
      expect(m[1]).not.toMatch(/precio|costo|base|importe|gastos|minimo/i);
    }
  });
});
