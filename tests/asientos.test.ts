import { describe, expect, it } from "vitest";
import {
  CUENTAS,
  asientoDeCompra,
  asientoDeGasto,
  asientoDePagoAProveedor,
  asientoDeVenta,
  balancea,
  type Asiento,
} from "@/lib/contable/asientos";

/**
 * Los asientos para el estudio contable.
 *
 * **La invariante es una sola y no se negocia: debe igual a haber.** Un asiento
 * desbalanceado es un archivo que el sistema del estudio rechaza entero, y eso
 * se descubre el día del vencimiento. Cada caso de acá comprueba primero eso y
 * después las cuentas concretas.
 */

describe("asientoDeVenta", () => {
  const venta = {
    fecha: new Date("2026-03-15"),
    comprobante: "Factura A 0001-00000123",
    cliente: "Constructora del Sur",
    neto: 100_000,
    iva: 21_000,
    tributos: 3_000,
    total: 124_000,
    esNotaDeCredito: false,
  };

  it("balancea", () => {
    expect(balancea(asientoDeVenta(venta))).toBe(true);
  });

  it("el cliente debe el total y las cuentas de resultado acreditan sus partes", () => {
    const a = asientoDeVenta(venta);

    const deudores = a.renglones.find((r) => r.cuenta === CUENTAS.deudores);
    expect(deudores?.debe).toBe(124_000);

    expect(a.renglones.find((r) => r.cuenta === CUENTAS.ventas)?.haber).toBe(
      100_000,
    );
    expect(
      a.renglones.find((r) => r.cuenta === CUENTAS.ivaDebito)?.haber,
    ).toBe(21_000);
    expect(
      a.renglones.find((r) => r.cuenta === CUENTAS.percepcionesIibb)?.haber,
    ).toBe(3_000);
  });

  it("una nota de crédito invierte el asiento entero", () => {
    /*
     * No se anota con importes negativos: se invierte. Los sistemas contables
     * rechazan importes negativos en un renglón, y un "haber de −100.000" no
     * significa nada para quien lo lee.
     */
    const a = asientoDeVenta({ ...venta, esNotaDeCredito: true });

    expect(balancea(a)).toBe(true);
    expect(a.renglones.find((r) => r.cuenta === CUENTAS.deudores)?.haber).toBe(
      124_000,
    );
    expect(a.renglones.find((r) => r.cuenta === CUENTAS.ventas)?.debe).toBe(
      100_000,
    );
  });

  it("sin percepciones no inventa el renglón", () => {
    const a = asientoDeVenta({ ...venta, tributos: 0, total: 121_000 });
    expect(
      a.renglones.some((r) => r.cuenta === CUENTAS.percepcionesIibb),
    ).toBe(false);
    expect(balancea(a)).toBe(true);
  });

  it("una factura B sin IVA discriminado igual balancea", () => {
    // El IVA existe aunque no se imprima: si no se anotara, el asiento no
    // cerraría contra el total cobrado.
    const a = asientoDeVenta({
      ...venta,
      neto: 82_644.63,
      iva: 17_355.37,
      tributos: 0,
      total: 100_000,
    });
    expect(balancea(a)).toBe(true);
  });
});

describe("asientoDeCompra", () => {
  const compra = {
    fecha: new Date("2026-03-10"),
    comprobante: "Factura A 0003-00001274",
    proveedor: "Aserradero El Ombú",
    neto: 200_000,
    iva: 42_000,
    percepciones: 5_000,
    total: 247_000,
    daCreditoFiscal: true,
    esNotaDeCredito: false,
  };

  it("balancea", () => {
    expect(balancea(asientoDeCompra(compra))).toBe(true);
  });

  it("el IVA va a crédito fiscal cuando el comprobante lo discrimina", () => {
    const a = asientoDeCompra(compra);
    expect(
      a.renglones.find((r) => r.cuenta === CUENTAS.ivaCredito)?.debe,
    ).toBe(42_000);
    expect(
      a.renglones.find((r) => r.cuenta === CUENTAS.proveedores)?.haber,
    ).toBe(247_000);
  });

  it("en una B el IVA es más costo, no crédito", () => {
    /*
     * **Es el error más caro del libro de compras.** La B no discrimina IVA:
     * mandarlo a crédito fiscal infla el crédito del mes contra un papel que no
     * lo respalda. Va adentro del costo de la mercadería.
     */
    const a = asientoDeCompra({ ...compra, daCreditoFiscal: false });

    expect(a.renglones.some((r) => r.cuenta === CUENTAS.ivaCredito)).toBe(false);
    expect(a.renglones.find((r) => r.cuenta === CUENTAS.mercaderias)?.debe).toBe(
      242_000,
    );
    expect(balancea(a)).toBe(true);
  });

  it("una nota de crédito del proveedor invierte el asiento", () => {
    const a = asientoDeCompra({ ...compra, esNotaDeCredito: true });
    expect(balancea(a)).toBe(true);
    expect(
      a.renglones.find((r) => r.cuenta === CUENTAS.proveedores)?.debe,
    ).toBe(247_000);
  });
});

describe("asientoDePagoAProveedor", () => {
  it("la retención es parte del pago, no un gasto", () => {
    /*
     * **La confusión que este asiento existe para evitar.** Se le pagan
     * $100.000 con $95.000 de transferencia y $5.000 de retención: la deuda
     * baja $100.000 y contra el fisco queda un pasivo de $5.000. Anotar la
     * retención como gasto la sacaría del pasivo y el saldo a depositar del
     * mes saldría mal.
     */
    const a = asientoDePagoAProveedor({
      fecha: new Date("2026-03-20"),
      proveedor: "Aserradero El Ombú",
      referencia: "TRF-99120",
      total: 100_000,
      retenido: 5_000,
      medio: "transferencia",
    });

    expect(balancea(a)).toBe(true);
    expect(
      a.renglones.find((r) => r.cuenta === CUENTAS.proveedores)?.debe,
    ).toBe(100_000);
    expect(a.renglones.find((r) => r.cuenta === CUENTAS.banco)?.haber).toBe(
      95_000,
    );
    expect(
      a.renglones.find((r) => r.cuenta === CUENTAS.retencionesAPagar)?.haber,
    ).toBe(5_000);
  });

  it("un pago en efectivo sale de caja y no del banco", () => {
    const a = asientoDePagoAProveedor({
      fecha: new Date("2026-03-20"),
      proveedor: "X",
      referencia: null,
      total: 50_000,
      retenido: 0,
      medio: "efectivo",
    });

    expect(a.renglones.find((r) => r.cuenta === CUENTAS.caja)?.haber).toBe(50_000);
    expect(a.renglones.some((r) => r.cuenta === CUENTAS.banco)).toBe(false);
    expect(balancea(a)).toBe(true);
  });

  it("sin retención no aparece el renglón del fisco", () => {
    const a = asientoDePagoAProveedor({
      fecha: new Date("2026-03-20"),
      proveedor: "X",
      referencia: null,
      total: 50_000,
      retenido: 0,
      medio: "transferencia",
    });
    expect(
      a.renglones.some((r) => r.cuenta === CUENTAS.retencionesAPagar),
    ).toBe(false);
  });
});

describe("asientoDeGasto", () => {
  it("balancea y sale de donde se pagó", () => {
    const a = asientoDeGasto({
      fecha: new Date("2026-03-05"),
      descripcion: "Flete a la obra de Alem",
      categoria: "flete",
      importe: 30_000,
      medio: "efectivo",
    });

    expect(balancea(a)).toBe(true);
    expect(a.renglones.find((r) => r.cuenta === CUENTAS.gastos)?.debe).toBe(
      30_000,
    );
    expect(a.renglones.find((r) => r.cuenta === CUENTAS.caja)?.haber).toBe(
      30_000,
    );
  });

  it("por transferencia sale del banco", () => {
    const a = asientoDeGasto({
      fecha: new Date("2026-03-05"),
      descripcion: "Luz",
      categoria: "servicios",
      importe: 80_000,
      medio: "transferencia",
    });
    expect(a.renglones.find((r) => r.cuenta === CUENTAS.banco)?.haber).toBe(
      80_000,
    );
  });
});

describe("balancea", () => {
  it("tolera medio centavo de redondeo", () => {
    const a: Asiento = {
      fecha: new Date(),
      concepto: "Prueba",
      renglones: [
        { cuenta: "1", nombre: "A", debe: 100.004, haber: 0 },
        { cuenta: "2", nombre: "B", debe: 0, haber: 100 },
      ],
    };
    expect(balancea(a)).toBe(true);
  });

  it("no tolera un centavo entero", () => {
    const a: Asiento = {
      fecha: new Date(),
      concepto: "Prueba",
      renglones: [
        { cuenta: "1", nombre: "A", debe: 100.01, haber: 0 },
        { cuenta: "2", nombre: "B", debe: 0, haber: 100 },
      ],
    };
    expect(balancea(a)).toBe(false);
  });
});

describe("todo asiento balancea", () => {
  it("ninguna combinación de importes lo rompe", () => {
    /*
     * Un asiento desbalanceado hace que el estudio rechace el archivo entero.
     * Vale la pena barrer los bordes: cero IVA, cero neto, importes con
     * fracciones que no dividen bien.
     */
    for (const neto of [0, 1, 33.33, 100_000, 1_234_567.89]) {
      for (const iva of [0, 0.21, 21_000, 259_259.26]) {
        for (const tributos of [0, 3_000]) {
          const total = neto + iva + tributos;
          expect(
            balancea(
              asientoDeVenta({
                fecha: new Date(),
                comprobante: "X",
                cliente: "Y",
                neto,
                iva,
                tributos,
                total,
                esNotaDeCredito: false,
              }),
            ),
          ).toBe(true);
        }
      }
    }
  });
});
