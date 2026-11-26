import { describe, expect, it } from "vitest";
import { cuentasDelPedido } from "@/lib/cuenta/cuentas-del-pedido";

describe("cuentasDelPedido (H209)", () => {
  it("con el descuento repartido en los renglones no lo resta otra vez", () => {
    // PED-1216: 40 × 26.010 + 60 × 7.740 + 10 × 83.430.
    const c = cuentasDelPedido({ sumaRenglones: 2_339_100, descuento: 259_900, costoEnvio: 0, total: 2_339_100 });
    expect(c).toEqual({ subtotal: 2_339_100, ahorro: 259_900, restaElAhorro: false });
  });
  it("con el descuento sobre el total lo resta en su línea", () => {
    const c = cuentasDelPedido({ sumaRenglones: 18_000, descuento: 1_800, costoEnvio: 500, total: 16_700 });
    expect(c).toEqual({ subtotal: 18_000, ahorro: 1_800, restaElAhorro: true });
  });
  it("sin descuento", () => {
    expect(cuentasDelPedido({ sumaRenglones: 100, descuento: 0, costoEnvio: 0, total: 100 })).toEqual({
      subtotal: 100,
      ahorro: 0,
      restaElAhorro: false,
    });
  });
});
