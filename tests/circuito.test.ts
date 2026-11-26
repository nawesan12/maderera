import { describe, expect, it } from "vitest";
import { etiquetaDeCircuito, etiquetasDelCircuito, fraseDelCircuito, rotuloDelCircuito } from "@/lib/circuito";

describe("el nombre del circuito sin factura (H167)", () => {
  it("de arranque es «B» y el chip dice «Circuito B»", () => {
    expect(etiquetasDelCircuito()).toEqual({ blanco: "Facturas", negro: "B" });
    expect(rotuloDelCircuito("b")).toBe("Circuito B");
    expect(etiquetaDeCircuito("negro")).toBe("B");
  });

  it("con la regla, la palabra elegida, también en una frase", () => {
    expect(etiquetaDeCircuito("negro", etiquetasDelCircuito("sin_factura"))).toBe("Sin factura");
    expect(etiquetaDeCircuito("blanco", etiquetasDelCircuito("interno"))).toBe("Facturas");
    expect(rotuloDelCircuito("sin_factura")).toBe("Sin factura");
    expect(rotuloDelCircuito("interno")).toBe("Circuito interno");
    expect(fraseDelCircuito("interno")).toBe("circuito interno");
  });
});
