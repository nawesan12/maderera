import { describe, expect, it } from "vitest";
import {
  importePorMedio,
  medioPrincipal,
  normalizarPagos,
  revisarPagos,
  type PagoDeVenta,
} from "@/lib/mostrador/importes";

/**
 * El pago partido del mostrador: mitad efectivo, mitad débito es una venta de
 * todos los días. Estas reglas deciden cuánto entra al cajón, cuánto va al
 * libro del cliente y qué dice el cierre Z, así que se prueban sin base.
 */

const pago = (medio: PagoDeVenta["medio"], importe: number): PagoDeVenta => ({
  medio,
  importe,
});

describe("normalizarPagos", () => {
  it("sin detalle, la venta es un solo pago por el total", () => {
    expect(normalizarPagos(undefined, "debito", 1500)).toEqual([
      { medio: "debito", importe: 1500 },
    ]);
    expect(normalizarPagos([], "efectivo", 800)).toEqual([
      { medio: "efectivo", importe: 800 },
    ]);
  });

  it("descarta renglones vacíos o en cero", () => {
    const pagos = normalizarPagos(
      [pago("efectivo", 500), pago("debito", 0), pago("credito", NaN)],
      "efectivo",
      500,
    );
    expect(pagos).toEqual([{ medio: "efectivo", importe: 500 }]);
  });

  it("redondea cada importe a centavos", () => {
    const pagos = normalizarPagos([pago("efectivo", 100.005)], "efectivo", 100);
    expect(pagos[0].importe).toBe(100.01);
  });
});

describe("revisarPagos", () => {
  it("acepta la suma exacta", () => {
    expect(
      revisarPagos([pago("efectivo", 600), pago("debito", 400)], 1000, null),
    ).toBeNull();
  });

  it("rechaza cuando la suma no da el total", () => {
    expect(
      revisarPagos([pago("efectivo", 600), pago("debito", 300)], 1000, null),
    ).toMatch(/suman/);
  });

  it("tolera el centavo del redondeo, pero no más", () => {
    expect(revisarPagos([pago("efectivo", 999.99)], 1000, null)).toBeNull();
    expect(revisarPagos([pago("efectivo", 999.97)], 1000, null)).not.toBeNull();
  });

  it("la parte en cuenta corriente exige cliente", () => {
    const pagos = [pago("efectivo", 500), pago("cuenta_corriente", 500)];
    expect(revisarPagos(pagos, 1000, null)).toMatch(/cliente/);
    expect(revisarPagos(pagos, 1000, "un-cliente")).toBeNull();
  });

  it("no acepta más de cuatro pagos", () => {
    const pagos = [
      pago("efectivo", 200),
      pago("debito", 200),
      pago("credito", 200),
      pago("transferencia", 200),
      pago("efectivo", 200),
    ];
    expect(revisarPagos(pagos, 1000, null)).toMatch(/cuatro/);
  });
});

describe("medioPrincipal e importePorMedio", () => {
  it("el principal es el de mayor importe: es lo que guarda el pedido", () => {
    expect(
      medioPrincipal([pago("efectivo", 300), pago("debito", 700)]),
    ).toBe("debito");
  });

  it("suma lo que entró por un medio, aunque venga en dos renglones", () => {
    const pagos = [
      pago("efectivo", 300),
      pago("efectivo", 200),
      pago("debito", 500),
    ];
    // Es el número que va al cajón: la caja no puede esperar el débito.
    expect(importePorMedio(pagos, "efectivo")).toBe(500);
    expect(importePorMedio(pagos, "cuenta_corriente")).toBe(0);
  });
});
