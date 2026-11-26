import { describe, expect, it } from "vitest";
import { pasadasACobrar } from "@/lib/mostrador/pasadas-confirmadas";

const p = (largoMm: number, anchoMm: number, cantidad: number) => ({ largoMm, anchoMm, cantidad, respetaVeta: 0 });

describe("pasadasACobrar (CRT-7302)", () => {
  const confirmado = { piezas: [p(500, 300, 2), p(400, 200, 1)], pasadas: 6 };
  it("con el despiece del corte, las confirmadas", () => {
    expect(pasadasACobrar(7, [p(400, 200, 1), p(500, 300, 2)], confirmado)).toBe(6);
  });
  it("con el despiece cambiado, las del plano", () => {
    expect(pasadasACobrar(7, [p(500, 300, 3), p(400, 200, 1)], confirmado)).toBe(7);
  });
  it("sin pasadas en el plano (placas enteras) no cobra", () => {
    expect(pasadasACobrar(0, confirmado.piezas, confirmado)).toBe(0);
  });
  it("sin corte de la cola, el plano", () => {
    expect(pasadasACobrar(7, confirmado.piezas, null)).toBe(7);
  });
});
