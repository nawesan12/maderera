import { describe, expect, it } from "vitest";
import { formatearImporte, formatearMonto } from "@/lib/formato";

const n = (s: string) => s.replace(/\u00a0/g, " ");

describe("formatearImporte", () => {
  it("muestra los centavos solo cuando los hay", () => {
    expect(n(formatearImporte(50000))).toBe("$ 50.000");
    expect(n(formatearImporte(50000.4))).toBe("$ 50.000,40");
    expect(n(formatearImporte(-0.4))).toBe("-$ 0,40");
    expect(n(formatearImporte(-1000.2))).toBe("-$ 1.000,20");
  });

  it("lo que redondea a cero es «$ 0», sin signo", () => {
    expect(n(formatearImporte(-0.001))).toBe("$ 0");
    expect(n(formatearImporte(0))).toBe("$ 0");
  });
});

describe("formatearMonto", () => {
  // Los centavos se muestran cuando los hay (mes simulado: el mostrador y la
  // cuenta del cliente decían montos distintos de la misma venta); lo que
  // redondea a cero no lleva signo (H148).
  it("no dice «-$ 0» de lo que redondea a cero (mes simulado, H148)", () => {
    expect(n(formatearMonto(-0.004))).toBe("$ 0");
    expect(n(formatearMonto(-0.4))).toBe("-$ 0,40");
    expect(n(formatearMonto(-470))).toBe("-$ 470");
  });
});
