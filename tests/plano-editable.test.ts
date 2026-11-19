import { describe, expect, it } from "vitest";
import { alSoltarEnPlaca } from "@/components/cortes/plano-editable";

/**
 * El toque en el plano (comité de T4): la pieza marcada quedaba marcada para
 * siempre y cualquier toque en otra placa la mudaba y la fijaba a mano.
 */
describe("soltar sobre una placa", () => {
  it("una pieza agarrada y soltada en su placa se marca; en otra, se manda", () => {
    expect(alSoltarEnPlaca({ numero: 1, agarradaEn: 1, elegidaEn: null })).toBe("marcar");
    expect(alSoltarEnPlaca({ numero: 2, agarradaEn: 1, elegidaEn: null })).toBe("mandarAgarrada");
  });

  it("con una marcada, el hueco de su placa la desmarca y el dibujo de otra la manda", () => {
    expect(alSoltarEnPlaca({ numero: 1, agarradaEn: null, elegidaEn: 1 })).toBe("desmarcar");
    expect(alSoltarEnPlaca({ numero: 2, agarradaEn: null, elegidaEn: 1 })).toBe("mandarElegida");
  });

  it("sin nada agarrado ni marcado, un toque no hace nada", () => {
    expect(alSoltarEnPlaca({ numero: 2, agarradaEn: null, elegidaEn: null })).toBe("nada");
  });

  it("el título de la placa no recibe el toque: solo el dibujo", async () => {
    const { readFileSync } = await import("node:fs");
    const fuente = readFileSync(new URL("../components/cortes/plano-editable.tsx", import.meta.url), "utf8");
    const figura = fuente.slice(fuente.indexOf("<figure"), fuente.indexOf("<figcaption"));
    expect(figura).not.toMatch(/onPointerUp/);
  });
});
