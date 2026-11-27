import { describe, expect, it } from "vitest";
import { cuentasDelPedido, nombreDelDescuento } from "@/lib/cuenta/cuentas-del-pedido";

describe("cuentasDelPedido (H209)", () => {
  it("con el descuento repartido en los renglones, el subtotal es el de antes del descuento (M2S2-116)", () => {
    // PED-1216: 40 × 26.010 + 60 × 7.740 + 10 × 83.430. Subtotal − descuento = total.
    const c = cuentasDelPedido({ sumaRenglones: 2_339_100, descuento: 259_900, costoEnvio: 0, total: 2_339_100 });
    expect(c).toEqual({ subtotal: 2_599_000, ahorro: 259_900, restaElAhorro: true });
  });
  it("si los números no cierran, no resta", () => {
    const c = cuentasDelPedido({ sumaRenglones: 1_000, descuento: 100, costoEnvio: 0, total: 950 });
    expect(c).toEqual({ subtotal: 1_000, ahorro: 100, restaElAhorro: false });
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
  it("el renglón del descuento dice cuál es", () => {
    expect(nombreDelDescuento("10% por transferencia")).toBe("10% por transferencia");
    expect(nombreDelDescuento(null)).toBe("Descuento");
  });
});
