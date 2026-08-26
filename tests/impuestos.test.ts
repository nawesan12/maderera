import { describe, expect, it } from "vitest";
import {
  agregarIva,
  calcularTotales,
  desagregar,
  redondear,
  sinImpuestosNacionales,
} from "@/lib/fiscal/impuestos";
import {
  discriminaIva,
  letraQueCorresponde,
  notaDeCredito,
  tipoFactura,
} from "@/lib/fiscal/comprobantes";

/**
 * La regla que gobierna toda la facturación: los precios del catálogo son
 * finales, con IVA incluido. Facturar desagrega; nunca al revés.
 *
 * Si esto se rompe, el total del checkout y el de la factura dejan de coincidir
 * y el cliente lo ve comparando el papel con lo que pagó.
 */
describe("desagregar", () => {
  it("parte el precio final en neto más IVA", () => {
    const { neto, iva, total } = desagregar(121, 21);

    expect(neto).toBe(100);
    expect(iva).toBe(21);
    expect(total).toBe(121);
  });

  it("hace que neto e IVA sumen exactamente el total", () => {
    // 528.300 es el importe del defecto que ya ocurrió una vez: conviene que
    // quede escrito como caso.
    for (const precio of [528300, 115560, 0.03, 1234.56, 99999.99]) {
      const { neto, iva, total } = desagregar(precio, 21);
      expect(redondear(neto + iva)).toBe(total);
    }
  });

  it("con alícuota cero deja todo como neto", () => {
    expect(desagregar(1000, 0)).toEqual({
      neto: 1000,
      iva: 0,
      total: 1000,
      alicuota: 0,
    });
  });

  it("es el inverso de agregar IVA", () => {
    expect(agregarIva(desagregar(1210, 21).neto, 21)).toBe(1210);
  });

  it("nunca calcula el IVA como neto por la alícuota", () => {
    // Con 100,01 el camino ingenuo (neto * 0,21 redondeado) da un centavo de
    // más que la diferencia contra el total.
    const { neto, iva, total } = desagregar(100.01, 21);
    expect(iva).toBe(redondear(total - neto));
  });
});

describe("calcularTotales", () => {
  it("desagrega sobre el total de la línea, no sobre el unitario", () => {
    // 15,5 m² a un precio con decimales: redondear el unitario primero
    // arrastraría el error multiplicado por la cantidad.
    const totales = calcularTotales([
      {
        descripcion: "Machimbre",
        cantidad: 15.5,
        precioFinalUnitario: 19636.33,
      },
    ]);

    expect(totales.total).toBe(redondear(19636.33 * 15.5));
    expect(redondear(totales.neto + totales.iva)).toBe(totales.total);
  });

  it("agrupa el IVA por alícuota, como lo pide ARCA", () => {
    const totales = calcularTotales([
      { descripcion: "A", cantidad: 1, precioFinalUnitario: 1210, alicuota: 21 },
      { descripcion: "B", cantidad: 1, precioFinalUnitario: 1105, alicuota: 10.5 },
    ]);

    expect(totales.ivaPorAlicuota.get(21)?.importe).toBe(210);
    expect(totales.ivaPorAlicuota.get(10.5)?.importe).toBe(105);
    expect(totales.iva).toBe(315);
  });

  it("manda lo no gravado a exento y no al IVA", () => {
    const totales = calcularTotales([
      { descripcion: "Libro", cantidad: 1, precioFinalUnitario: 5000, alicuota: 0 },
    ]);

    expect(totales.exento).toBe(5000);
    expect(totales.iva).toBe(0);
    expect(totales.ivaPorAlicuota.size).toBe(0);
  });

  it("una lista vacía da todo en cero y no NaN", () => {
    const totales = calcularTotales([]);
    expect(totales.total).toBe(0);
    expect(totales.neto).toBe(0);
  });
});

describe("letra del comprobante", () => {
  it("entre responsables inscriptos sale A", () => {
    expect(
      letraQueCorresponde("responsable_inscripto", "responsable_inscripto"),
    ).toBe("A");
  });

  it("de inscripto a consumidor final sale B", () => {
    expect(letraQueCorresponde("responsable_inscripto", "consumidor_final")).toBe(
      "B",
    );
  });

  it("un monotributista siempre emite C", () => {
    expect(letraQueCorresponde("monotributista", "responsable_inscripto")).toBe(
      "C",
    );
    expect(letraQueCorresponde("monotributista", "consumidor_final")).toBe("C");
  });
});

describe("discriminación de IVA", () => {
  it("la A discrimina", () => {
    expect(discriminaIva(tipoFactura("A"))).toBe(true);
  });

  it("la B no discrimina en el papel", () => {
    // Pero el IVA existe igual y se informa a ARCA: la maqueta vieja lo daba
    // por cero, que era el defecto.
    expect(discriminaIva(tipoFactura("B"))).toBe(false);

    const totales = calcularTotales([
      { descripcion: "Placa", cantidad: 1, precioFinalUnitario: 121 },
    ]);
    expect(totales.iva).toBe(21);
  });
});

describe("notas de crédito", () => {
  it("conservan la letra del comprobante que corrigen", () => {
    expect(notaDeCredito(tipoFactura("A"))).toBe("nota_credito_a");
    expect(notaDeCredito(tipoFactura("B"))).toBe("nota_credito_b");
    expect(notaDeCredito(tipoFactura("C"))).toBe("nota_credito_c");
  });
});

describe("transparencia fiscal (ley 27.743)", () => {
  it("informa el mismo neto que después va a la factura", () => {
    const precio = 115560;
    expect(sinImpuestosNacionales(precio)).toBe(desagregar(precio, 21).neto);
  });
});
