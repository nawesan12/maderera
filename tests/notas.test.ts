import { describe, expect, it } from "vitest";
import {
  esRectificativo,
  lineasDeLaNota,
  prorratearTributos,
  revisarAcreditacion,
  type ItemOriginal,
} from "@/lib/fiscal/notas";
import { esNotaDeCredito, notaDeCredito, notaDeDebito } from "@/lib/fiscal/comprobantes";

/**
 * Notas de crédito y de débito.
 *
 * Hasta acá la anulación era siempre por el total, copiaba el 100 % de los
 * renglones y marcaba el original como anulado **incondicionalmente**. Nada de
 * eso tenía una sola prueba, y es la única parte del sistema que emite
 * documentos con valor fiscal.
 */

const items: ItemOriginal[] = [
  {
    id: "i1",
    descripcion: "Fenólico 18mm",
    unidad: "unidad",
    cantidad: 10,
    subtotal: 121_000, // 10 × 12.100 finales
    alicuotaIva: 21,
  },
  {
    id: "i2",
    descripcion: "Flete",
    unidad: "servicio",
    cantidad: 1,
    subtotal: 11_050,
    alicuotaIva: 10.5,
  },
];

describe("lineasDeLaNota", () => {
  it("por el total copia todos los renglones enteros", () => {
    const r = lineasDeLaNota(items, null);

    expect(r).toHaveLength(2);
    expect(r[0].cantidad).toBe(10);
    expect(r[0].precioFinalUnitario).toBe(12_100);
    expect(r[1].precioFinalUnitario).toBe(11_050);
  });

  it("el precio unitario sale del original, no de la cantidad parcial", () => {
    /*
     * **Es exactamente el bug que se está evitando.** Dividir el subtotal por
     * la cantidad *parcial* daría un unitario inflado: devolver 2 de 10 placas
     * a $121.000 la unidad en vez de $12.100.
     */
    const r = lineasDeLaNota(items, [{ itemId: "i1", cantidad: 2 }]);

    expect(r).toHaveLength(1);
    expect(r[0].precioFinalUnitario).toBe(12_100);
    expect(r[0].cantidad).toBe(2);
    expect(r[0].itemOrigenId).toBe("i1");
  });

  it("ignora los renglones que no se acreditan", () => {
    const r = lineasDeLaNota(items, [{ itemId: "i2", cantidad: 1 }]);
    expect(r).toHaveLength(1);
    expect(r[0].descripcion).toBe("Flete");
  });

  it("no deja acreditar más cantidad de la facturada", () => {
    expect(() => lineasDeLaNota(items, [{ itemId: "i1", cantidad: 11 }])).toThrow(
      /más de lo facturado/i,
    );
  });

  it("una cantidad de cero o negativa no genera renglón", () => {
    const r = lineasDeLaNota(items, [
      { itemId: "i1", cantidad: 0 },
      { itemId: "i2", cantidad: 1 },
    ]);
    expect(r).toHaveLength(1);
  });

  it("un renglón con cantidad cero en el original no divide por cero", () => {
    const raro: ItemOriginal[] = [
      { id: "x", descripcion: "Ajuste", unidad: "unidad", cantidad: 0, subtotal: 500, alicuotaIva: 21 },
    ];
    const r = lineasDeLaNota(raro, null);
    expect(r[0].precioFinalUnitario).toBe(0);
  });
});

describe("prorratearTributos", () => {
  it("copia los tributos del original en proporción a lo acreditado", () => {
    /*
     * Se copian del original en vez de recalcularse con la configuración de
     * hoy: una nota emitida después de cambiar la alícuota de percepción no
     * cerraba contra su factura.
     */
    const tributos = [
      { codigo: "02", descripcion: "Percepción IIBB", base: 100_000, alicuota: 3, importe: 3_000 },
    ];

    const r = prorratearTributos(tributos, 0.25);

    expect(r[0].base).toBe(25_000);
    expect(r[0].importe).toBe(750);
    // La alícuota no se prorratea: sigue siendo la misma que tuvo la factura.
    expect(r[0].alicuota).toBe(3);
  });

  it("por el total los deja iguales", () => {
    const tributos = [
      { codigo: "02", descripcion: "Percepción IIBB", base: 100_000, alicuota: 3, importe: 3_000 },
    ];
    expect(prorratearTributos(tributos, 1)).toEqual(tributos);
  });

  it("sin tributos no inventa ninguno", () => {
    expect(prorratearTributos([], 0.5)).toEqual([]);
  });
});

describe("revisarAcreditacion", () => {
  it("deja acreditar lo que falta", () => {
    expect(revisarAcreditacion(121_000, 21_000, 100_000)).toBeNull();
  });

  it("no deja acreditar más que el total de la factura", () => {
    /*
     * Sin este tope, dos notas de crédito parciales por descuido acreditan más
     * de lo que se facturó y el libro IVA queda con IVA negativo contra un
     * comprobante que no lo respalda.
     */
    expect(revisarAcreditacion(121_000, 100_000, 30_000)).toMatch(
      /ya se acreditaron/i,
    );
  });

  it("deja llegar justo al total", () => {
    expect(revisarAcreditacion(121_000, 21_000, 100_000)).toBeNull();
  });

  it("rechaza un monto de cero o negativo", () => {
    expect(revisarAcreditacion(121_000, 0, 0)).toMatch(/mayor a cero/i);
    expect(revisarAcreditacion(121_000, 0, -5)).toMatch(/mayor a cero/i);
  });

  it("tolera que la suma de los renglones se pase por medio centavo", () => {
    /*
     * El total del original está redondeado a dos decimales y el de la nota es
     * la suma de renglones redondeados por separado: pueden diferir en una
     * fracción. Sin tolerancia, acreditar el 100 % de una factura fallaría por
     * cuatro milésimas y no habría forma de anularla.
     */
    expect(revisarAcreditacion(121_000, 0, 121_000.004)).toBeNull();
    // Un centavo entero sí es un error de carga, no un redondeo.
    expect(revisarAcreditacion(121_000, 0, 121_000.01)).toMatch(
      /ya se acreditaron/i,
    );
  });
});

describe("esRectificativo", () => {
  it("las notas de crédito y de débito llevan comprobante asociado", () => {
    /*
     * **El bug que esto arregla:** el XML mandaba `CbtesAsoc` solo si era nota
     * de crédito, así que una nota de débito salía sin él y ARCA lo exige.
     */
    expect(esRectificativo("nota_credito_a")).toBe(true);
    expect(esRectificativo("nota_debito_a")).toBe(true);
    expect(esRectificativo("nota_debito_b")).toBe(true);
    expect(esRectificativo("nota_debito_c")).toBe(true);
  });

  it("una factura no lleva ninguno", () => {
    expect(esRectificativo("factura_a")).toBe(false);
    expect(esRectificativo("factura_b")).toBe(false);
  });

  it("es más amplio que el predicado de nota de crédito", () => {
    // Si volvieran a coincidir, el bug de la nota de débito estaría de vuelta.
    expect(esNotaDeCredito("nota_debito_a")).toBe(false);
    expect(esRectificativo("nota_debito_a")).toBe(true);
  });
});

describe("la letra se hereda del comprobante corregido", () => {
  it("la nota de crédito de una A es una A", () => {
    expect(notaDeCredito("factura_a")).toBe("nota_credito_a");
    expect(notaDeCredito("factura_b")).toBe("nota_credito_b");
  });

  it("la nota de débito también", () => {
    expect(notaDeDebito("factura_a")).toBe("nota_debito_a");
    expect(notaDeDebito("factura_c")).toBe("nota_debito_c");
  });
});
