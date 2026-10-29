import { describe, expect, it } from "vitest";
import {
  efectoEnLaCuenta,
  puedePasar,
  TRANSICIONES,
  type EstadoDeCheque,
} from "@/lib/cheques/estados";
import {
  nombreDelCheque,
  normalizarNumeroDeCheque,
  revisarNumeroDeCheque,
} from "@/lib/cheques/numero";
import { importeEnLetras, revisarPartes, totalDePartes } from "@/lib/cobros/partes";
import { leerPartes } from "@/lib/cobros/leer";
import { lineasDeLaFactura } from "@/lib/entregas/factura-del-remito";

/**
 * Los cheques del cliente, de la nota del 30/9/2026: «poder marcar cheques
 * como aceptados o rechazados, y que se plasme en el usuario final».
 *
 * Lo que se fija es qué le hace cada cambio a la cuenta: una transición de más
 * es plata que aparece o desaparece.
 */
describe("los estados del cheque", () => {
  it("aceptar uno informado acredita; rechazarlo no toca la cuenta", () => {
    expect(efectoEnLaCuenta("informado", "cartera")).toBe("acreditar");
    expect(efectoEnLaCuenta("informado", "rechazado")).toBe("nada");
  });

  it("el rechazo del banco devuelve la deuda, esté donde esté el cheque", () => {
    for (const desde of ["cartera", "depositado", "entregado"] as EstadoDeCheque[]) {
      expect(efectoEnLaCuenta(desde, "rechazado")).toBe("debitar");
    }
  });

  it("moverlo de lugar no cambia la cuenta", () => {
    expect(efectoEnLaCuenta("cartera", "depositado")).toBe("nada");
    expect(efectoEnLaCuenta("depositado", "acreditado")).toBe("nada");
  });

  it("los estados finales son finales", () => {
    for (const final of ["acreditado", "rechazado", "anulado"] as EstadoDeCheque[]) {
      expect(TRANSICIONES[final]).toEqual([]);
    }
    expect(puedePasar("rechazado", "cartera")).toBe(false);
    // Uno informado no se deposita sin aceptarlo antes: no lo tenemos.
    expect(puedePasar("informado", "depositado")).toBe(false);
  });
});

describe("el número del cheque", () => {
  it("se guarda solo con dígitos, conservando los ceros de adelante", () => {
    expect(normalizarNumeroDeCheque("0012-3456")).toBe("00123456");
    expect(normalizarNumeroDeCheque(" 12 345 678 ")).toBe("12345678");
  });

  it("se pide, y no se acepta uno que es claramente un error", () => {
    expect(revisarNumeroDeCheque("")).toMatch(/número/);
    expect(revisarNumeroDeCheque("12")).toMatch(/corto/);
    expect(revisarNumeroDeCheque("12345678")).toBeNull();
  });

  it("se nombra como se lo busca en el banco", () => {
    expect(nombreDelCheque({ tipo: "fisico", banco: "Banco Nación", numero: "12345678" })).toBe(
      "Cheque Banco Nación N° 12345678",
    );
    expect(nombreDelCheque({ tipo: "echeq", banco: null, numero: "123456" })).toBe("e-Cheq N° 123456");
  });
});

describe("las partes de un cobro", () => {
  const cheque = {
    medio: "cheque" as const,
    importe: 100_000,
    cheque: { numero: "12345678", banco: "Banco Nación", fechaPago: new Date("2026-11-15T12:00:00") },
  };

  it("suma al centavo", () => {
    expect(totalDePartes([{ importe: 0.1 }, { importe: 0.2 }])).toBe(0.3);
  });

  it("acepta efectivo más cheques", () => {
    expect(revisarPartes([{ medio: "efectivo", importe: 5000 }, cheque])).toBeNull();
  });

  it("un cheque sin número, banco o fecha no pasa", () => {
    expect(revisarPartes([{ ...cheque, cheque: { ...cheque.cheque, numero: "" } }])).toMatch(/número/);
    expect(revisarPartes([{ ...cheque, cheque: { ...cheque.cheque, banco: " " } }])).toMatch(/banco/);
    expect(
      revisarPartes([{ ...cheque, cheque: { ...cheque.cheque, fechaPago: new Date("x") } }]),
    ).toMatch(/fecha/);
  });

  it("un e-Cheq no va por el circuito B", () => {
    expect(revisarPartes([{ ...cheque, medio: "echeq" }], "negro")).toMatch(/circuito B/);
    expect(revisarPartes([cheque], "negro")).toBeNull();
  });

  it("el mismo cheque dos veces es un doble clic", () => {
    const id = "6f1c2b9e-1d1a-4a43-9f43-1b2c3d4e5f60";
    expect(
      revisarPartes([
        { medio: "cheque", importe: 1, chequeId: id },
        { medio: "cheque", importe: 1, chequeId: id },
      ]),
    ).toMatch(/dos veces/);
  });

  it("lee lo que manda el formulario, con la fecha a mediodía", () => {
    const leido = leerPartes(
      JSON.stringify([
        { medio: "cheque", importe: "150.000,50", cheque: { numero: "1234", banco: "BBVA", fechaPago: "2026-11-15" } },
      ]),
    );
    expect("partes" in leido).toBe(true);
    if ("partes" in leido) {
      expect(leido.partes[0]!.importe).toBe(150000.5);
      expect(leido.partes[0]!.cheque!.fechaPago.getHours()).toBe(12);
    }
    expect(leerPartes("no es json")).toEqual({ error: expect.any(String) });
  });
});

describe("el importe en letras del recibo", () => {
  it("escribe los casos que más se equivocan a mano", () => {
    expect(importeEnLetras(100)).toBe("cien con 00/100");
    expect(importeEnLetras(101)).toBe("ciento uno con 00/100");
    expect(importeEnLetras(21_000)).toBe("veintiún mil con 00/100");
    expect(importeEnLetras(1_000)).toBe("mil con 00/100");
    expect(importeEnLetras(1_000_000)).toBe("un millón con 00/100");
    expect(importeEnLetras(2_500_000.5)).toBe("dos millones quinientos mil con 50/100");
    expect(importeEnLetras(345_678.9)).toBe(
      "trescientos cuarenta y cinco mil seiscientos setenta y ocho con 90/100",
    );
  });

  it("escribe los miles de millones (antes mil millones salía «millones»)", () => {
    expect(importeEnLetras(1_000_000_000)).toBe("mil millones con 00/100");
    expect(importeEnLetras(1_001_000_000)).toBe("mil un millones con 00/100");
    expect(importeEnLetras(1_521_000_300)).toBe("mil quinientos veintiún millones trescientos con 00/100");
  });
});


describe("la factura en el remito", () => {
  it("nombra la factura y su CAE, y no inventa nada si falta", () => {
    expect(lineasDeLaFactura(null)).toEqual(["Sin factura asociada"]);
    expect(lineasDeLaFactura({ etiqueta: "Factura B 0015-00000001", cae: null, caeVencimiento: null })).toEqual([
      "Factura B 0015-00000001",
      "Sin CAE: sin valor fiscal",
    ]);
    expect(
      lineasDeLaFactura({
        etiqueta: "Factura A 0015-00000002",
        cae: "76123456789012",
        caeVencimiento: new Date("2026-10-11T00:00:00Z"),
      }),
    ).toEqual(["Factura A 0015-00000002", "CAE 76123456789012 · vto. 11/10/26"]);
  });
});
