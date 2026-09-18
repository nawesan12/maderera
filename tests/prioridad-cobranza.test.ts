import { describe, expect, it } from "vitest";
import { prioridadDeCobranza } from "@/lib/cuenta-corriente/prioridad";

/**
 * Se prueba porque el orden en que se llama a la cartera es una decisión de
 * plata, y la intuición ordena mal: la lista por saldo pone arriba al que más
 * compra —que suele ser el que mejor paga— y deja abajo la deuda chica de hace
 * cuatro meses, que es la que de verdad se puede perder.
 */
describe("a quién llamar primero", () => {
  const base = { diasCredito: 30, bloqueada: false };

  it("el que está en término no entra en la cobranza", () => {
    const p = prioridadDeCobranza({
      ...base,
      vencido: 500_000,
      diasDeLaMasVieja: 12,
    });

    expect(p.urgencia).toBe("al-dia");
    expect(p.puntaje).toBe(0);
  });

  it("cuenta los días pasados del plazo, no los de la deuda", () => {
    // 45 días de deuda con 30 de plazo son 15 días de atraso.
    const p = prioridadDeCobranza({
      ...base,
      vencido: 100_000,
      diasDeLaMasVieja: 45,
    });

    expect(p.diasVencida).toBe(15);
    expect(p.urgencia).toBe("atrasada");
  });

  it("pasado el doble del plazo pasa a ser urgente", () => {
    const p = prioridadDeCobranza({
      ...base,
      vencido: 100_000,
      diasDeLaMasVieja: 75,
    });

    expect(p.urgencia).toBe("urgente");
  });

  it("la deuda vieja y chica le gana a la nueva y grande", () => {
    // Es el corazón del asunto: $2.000.000 comprados hace 31 días no son un
    // problema; $300.000 de hace cuatro meses sí.
    const nueva = prioridadDeCobranza({
      ...base,
      vencido: 2_000_000,
      diasDeLaMasVieja: 31,
    });
    const vieja = prioridadDeCobranza({
      ...base,
      vencido: 300_000,
      diasDeLaMasVieja: 150,
    });

    expect(vieja.puntaje).toBeGreaterThan(nueva.puntaje);
  });

  it("respeta el plazo propio de cada cliente", () => {
    // A la constructora con 60 días de plazo, 45 días de deuda no la atrasan.
    const p = prioridadDeCobranza({
      vencido: 800_000,
      diasDeLaMasVieja: 45,
      diasCredito: 60,
      bloqueada: false,
    });

    expect(p.urgencia).toBe("al-dia");
  });

  it("la cuenta bloqueada va arriba de todo", () => {
    const bloqueada = prioridadDeCobranza({
      ...base,
      vencido: 1,
      diasDeLaMasVieja: 31,
      bloqueada: true,
    });
    const grande = prioridadDeCobranza({
      ...base,
      vencido: 9_000_000,
      diasDeLaMasVieja: 400,
    });

    expect(bloqueada.puntaje).toBeGreaterThan(grande.puntaje);
    expect(bloqueada.urgencia).toBe("bloqueada");
  });
});
