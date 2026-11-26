import { describe, expect, it } from "vitest";
import { notaDelPresupuesto } from "@/app/mostrador/medios";

const n = (s: string | null) => s?.replace(/\u00a0/g, " ");

describe("el presupuesto del mostrador", () => {
  it("lleva el total de la pantalla cuando hay descuento por pagar en efectivo (mes simulado, H021)", () => {
    expect(
      n(notaDelPresupuesto({ descuento: 179145, descuentoManual: 0, medio: "efectivo", motivo: "10% en efectivo", total: 1612305 })),
    ).toBe("Pagando en efectivo (10% en efectivo): $ 1.612.305.");
  });

  it("sin descuento no agrega nada", () => {
    expect(notaDelPresupuesto({ descuento: 0, descuentoManual: 0, medio: "efectivo", motivo: "", total: 1000 })).toBeNull();
  });
});
