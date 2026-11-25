import { describe, expect, it } from "vitest";
import { focoDespuesDe, type DespuesDe } from "@/lib/mostrador/foco";

/**
 * A dónde vuelve el cursor (crítica del operario, T4): si queda en un botón o
 * en ninguna parte, el próximo código que pasa la pistola se pierde.
 */
describe("el cursor vuelve al buscador", () => {
  const efectivo = { medio: "efectivo", partido: false };

  it("después de cerrar el corte, la carga a mano, la caja y «Vaciar»", () => {
    const todos: DespuesDe[] = ["corte", "corte-agregado", "a-mano", "caja", "vaciar", "no-vaciar"];
    for (const que of todos) expect(focoDespuesDe(que, efectivo)).toBe("buscador");
  });

  it("la caja abierta desde el cobro vuelve a con cuánto paga, no al botón de cobrar", () => {
    expect(focoDespuesDe("caja-para-cobrar", efectivo)).toBe("recibido");
  });

  it("con el pago partido no hay «con cuánto paga»: vuelve al buscador", () => {
    expect(focoDespuesDe("caja-para-cobrar", { medio: "efectivo", partido: true })).toBe("buscador");
    expect(focoDespuesDe("caja-para-cobrar", { medio: "debito", partido: false })).toBe("buscador");
  });
});
