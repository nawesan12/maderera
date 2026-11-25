import { describe, expect, it } from "vitest";
import { aAutorizar, desvioDeLaVenta, type LineaDeVenta } from "@/lib/mostrador/importes";

/*
 * El aviso del mostrador antes de cobrar sigue la regla de Go
 * (ventas.DesvioDeLaVenta, TestDesvioDeLaVenta): los mismos casos dan lo
 * mismo, si no el total se pone naranja y Go no pide el PIN, o al revés.
 */
const placa: LineaDeVenta = { variantId: "v1", descripcion: "Placa", unidad: "placa", cantidad: 2, precioUnitario: 45000, precioLista: 45000.5 };
const tornillo: LineaDeVenta = { variantId: "v2", descripcion: "Tornillo", unidad: "unidad", cantidad: 100, precioUnitario: 160, precioLista: 150 };
const flete: LineaDeVenta = { variantId: null, descripcion: "Flete", unidad: "unidad", cantidad: 1, precioUnitario: 12000 };

describe("lo que la venta deja de cobrar", () => {
  it("un renglón por encima no compensa a otro por debajo", () => {
    expect(desvioDeLaVenta([placa, tornillo, flete], 0)).toEqual({ total: 1, base: 117001 });
  });

  it("el redondeo sobre el total cuenta, y el borde del 5 %", () => {
    expect(aAutorizar(desvioDeLaVenta([placa, tornillo, flete], 2001), 5)).toBe(0);
    expect(aAutorizar(desvioDeLaVenta([placa, tornillo, flete], 5849.05), 5)).toBe(0);
    expect(aAutorizar(desvioDeLaVenta([placa, tornillo, flete], 5850.05), 5)).toBe(5851.05);
  });

  it("con 0 % todo pide; sin nada dejado, nada", () => {
    expect(aAutorizar(desvioDeLaVenta([placa], 0), 0)).toBe(1);
    expect(aAutorizar(desvioDeLaVenta([tornillo, flete], 0), 0)).toBe(0);
  });
});
