import { describe, expect, it } from "vitest";
import {
  RETARDO_MAXIMO_MS,
  retardoDeAviso,
} from "@/lib/mostrador/offline/sincronizar";

/*
 * Cuando cambian los precios, el aviso les llega a todas las cajas a la vez.
 * Cada una espera un rato al azar antes de sincronizar: siempre entre cero y
 * treinta segundos, nunca negativo ni más, aunque el azar devuelva cualquier
 * cosa.
 */
describe("retardo después del aviso de precios", () => {
  it("cae siempre en [0, 30 s)", () => {
    for (const azar of [0, 0.5, 0.999_999_9, 1, -1, 2, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = retardoDeAviso(() => azar);
      expect(r, String(azar)).toBeGreaterThanOrEqual(0);
      expect(r, String(azar)).toBeLessThan(RETARDO_MAXIMO_MS);
      expect(Number.isInteger(r)).toBe(true);
    }
    expect(retardoDeAviso(() => 0.5)).toBe(15_000);
  });

  it("con el azar de verdad, también", () => {
    for (let i = 0; i < 1000; i++) {
      const r = retardoDeAviso();
      expect(r >= 0 && r < RETARDO_MAXIMO_MS).toBe(true);
    }
  });
});
