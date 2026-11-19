import { describe, expect, it } from "vitest";
import { fechaHora, hora } from "@/lib/formato";
import { NOMBRE_DEL_MEDIO } from "@/app/mostrador/medios";

/**
 * Las ventas de hoy y la caja decían «12:16 a. m. · cuenta corriente»: la
 * hora en 12 h de `toLocaleTimeString` y la clave interna del medio (comité
 * final). Ahora salen de `lib/formato` y de los nombres del mostrador.
 */
describe("la hora y el medio en el mostrador", () => {
  it("la hora va en 24 h y en hora argentina", () => {
    expect(hora.format(new Date("2026-11-19T03:16:00Z"))).toBe("00:16");
    expect(hora.format(new Date("2026-11-19T17:05:00Z"))).toBe("14:05");
    expect(fechaHora.format(new Date("2026-11-19T17:05:00Z"))).not.toMatch(/m\./);
  });
  it("el medio se dice con su nombre", () => {
    expect(NOMBRE_DEL_MEDIO.cuenta_corriente).toBe("Cuenta corriente");
    expect(NOMBRE_DEL_MEDIO.debito).toBe("Débito");
  });
});
