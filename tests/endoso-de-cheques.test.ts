import { describe, expect, it } from "vitest";
import { type ChequeDeCartera, chequesParaEndosar, sinEndososDelOtroCircuito } from "@/app/admin/compras/pagos/endoso";

/**
 * Qué cheques de la cartera ofrece la pantalla de pagos a proveedores.
 *
 * Se prueba porque la regla de Go (un cheque se endosa en un pago de su mismo
 * circuito) rechazaba recién al guardar: la pantalla ofrecía los dos
 * circuitos y el error aparecía después de cargar todo el pago.
 */
const cheque = (id: string, tipo: string, circuito: "blanco" | "negro", importe = 1000): ChequeDeCartera => ({
  id,
  numero: id,
  banco: null,
  fechaPago: "2026-12-01",
  importe,
  tipo,
  cliente: null,
  circuito,
});

const cartera = [cheque("F1", "fisico", "blanco"), cheque("B1", "fisico", "negro", 500), cheque("E1", "echeq", "blanco")];

describe("chequesParaEndosar", () => {
  it("en un pago blanco, el cheque B queda aparte", () => {
    const { endosables, delOtroCircuito } = chequesParaEndosar(cartera, "cheque", "blanco");
    expect(endosables.map((c) => c.id)).toEqual(["F1"]);
    expect(delOtroCircuito.map((c) => c.id)).toEqual(["B1"]);
  });

  it("en un pago B, solo el cheque B", () => {
    const { endosables, delOtroCircuito } = chequesParaEndosar(cartera, "cheque", "negro");
    expect(endosables.map((c) => c.id)).toEqual(["B1"]);
    expect(delOtroCircuito.map((c) => c.id)).toEqual(["F1"]);
  });

  it("un e-Cheq no se ofrece como cheque físico", () => {
    expect(chequesParaEndosar(cartera, "cheque", "blanco").endosables.some((c) => c.tipo === "echeq")).toBe(false);
    expect(chequesParaEndosar(cartera, "echeq", "blanco").endosables.map((c) => c.id)).toEqual(["E1"]);
  });

  it("un pago sin circuito es blanco, como en Go", () => {
    expect(chequesParaEndosar(cartera, "cheque", "").endosables.map((c) => c.id)).toEqual(["F1"]);
  });

  it("la transferencia no ofrece cheques", () => {
    expect(chequesParaEndosar(cartera, "transferencia", "blanco")).toEqual({ endosables: [], delOtroCircuito: [], esperanCae: [] });
  });

  // M2S2-040: con «endoso_espera_cae» en «al_cae», el que espera el CAE va
  // apagado bajo «Espera CAE»; con la de arranque, se endosa como blanco.
  it("el que espera el CAE y está trabado por la regla va aparte", () => {
    const conCae = [...cartera, { ...cheque("C1", "fisico", "blanco"), esperaCae: true, trabado: true }];
    const r = chequesParaEndosar(conCae, "cheque", "blanco");
    expect(r.endosables.map((c) => c.id)).toEqual(["F1"]);
    expect(r.esperanCae.map((c) => c.id)).toEqual(["C1"]);
    const libre = [...cartera, { ...cheque("C1", "fisico", "blanco"), esperaCae: true, trabado: false }];
    expect(chequesParaEndosar(libre, "cheque", "blanco").endosables.map((c) => c.id)).toEqual(["F1", "C1"]);
  });
});

describe("sinEndososDelOtroCircuito", () => {
  it("al pasar a B se limpia el endoso del cheque blanco y su importe heredado", () => {
    const partes = [
      { medio: "cheque", importe: "1000", chequeId: "F1" },
      { medio: "cheque", importe: "500", chequeId: "B1" },
      { medio: "transferencia", importe: "200", chequeId: "" },
    ];
    expect(sinEndososDelOtroCircuito(partes, cartera, "negro")).toEqual([
      { medio: "cheque", importe: "", chequeId: "" },
      { medio: "cheque", importe: "500", chequeId: "B1" },
      { medio: "transferencia", importe: "200", chequeId: "" },
    ]);
  });

  it("un importe tipeado a mano se respeta", () => {
    expect(sinEndososDelOtroCircuito([{ medio: "cheque", importe: "750", chequeId: "B1" }], cartera, "blanco")).toEqual([
      { medio: "cheque", importe: "750", chequeId: "" },
    ]);
  });
});
