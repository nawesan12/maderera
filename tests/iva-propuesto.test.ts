import { describe, expect, it } from "vitest";
import { discriminaIva, ivaPropuesto } from "@/lib/fiscal/comprobantes-compra";

describe("ivaPropuesto", () => {
  it("la A y la M llevan el 21 % del neto", () => {
    expect(ivaPropuesto(100000, "factura_a")).toBe(21000);
    expect(ivaPropuesto(1234.57, "nota_credito_a")).toBe(259.26);
    expect(ivaPropuesto(10, "factura_m")).toBe(2.1);
  });
  it("la B, la C y el ticket no discriminan", () => {
    for (const t of ["factura_b", "factura_c", "nota_debito_c", "ticket", "otro"]) {
      expect(discriminaIva(t)).toBe(false);
      expect(ivaPropuesto(1000, t)).toBe(0);
    }
  });
  it("sin neto, nada", () => {
    expect(ivaPropuesto(0, "factura_a")).toBe(0);
    expect(ivaPropuesto(NaN, "factura_a")).toBe(0);
  });
});
