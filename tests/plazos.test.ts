import { describe, expect, it } from "vitest";
import { estadoDelPlazo, vencimientoExpress } from "@/lib/plazos";

/**
 * El compromiso del portal profesional es responder en 24 horas, salteando el
 * fin de semana. Contarlo mal hace que el panel muestre en rojo cosas que
 * están a tiempo, y a los tres días nadie mira el indicador.
 */

/** Lunes 24 de agosto de 2026, 10:00. */
const lunes10 = new Date(2026, 7, 24, 10, 0, 0);

describe("vencimientoExpress", () => {
  it("son 24 horas de reloj", () => {
    // Lunes 10:00 -> martes 10:00.
    const r = vencimientoExpress(lunes10);
    expect(r.getDate()).toBe(25);
    expect(r.getHours()).toBe(10);
  });

  it("un pedido del viernes vence el lunes, no el sábado", () => {
    const viernes15 = new Date(2026, 7, 28, 15, 0, 0);
    const r = vencimientoExpress(viernes15);
    expect(r.getDay()).toBe(1);
    expect(r.getDate()).toBe(31);
    expect(r.getHours()).toBe(15);
  });

  it("un pedido del sábado vence el lunes", () => {
    const sabado = new Date(2026, 7, 29, 10, 0, 0);
    const r = vencimientoExpress(sabado);
    expect(r.getDay()).toBe(1);
  });

  it("no vence de madrugada: se corre a la apertura", () => {
    // Marcar algo como atrasado a las 8 cuando recién ahí se puede contestar
    // haría que el indicador deje de significar algo.
    const martes3 = new Date(2026, 7, 25, 3, 0, 0);
    const r = vencimientoExpress(martes3);
    expect(r.getHours()).toBe(8);
  });

  it("no vence después del cierre: llega hasta el final del día", () => {
    const martes20 = new Date(2026, 7, 25, 20, 0, 0);
    const r = vencimientoExpress(martes20);
    expect(r.getHours()).toBe(16);
  });
});

describe("estadoDelPlazo", () => {
  const ahora = new Date(2026, 7, 24, 10, 0, 0);

  it("sin fecha no dice nada", () => {
    expect(estadoDelPlazo(null, ahora).texto).toBe("");
  });

  it("marca urgente cuando quedan menos de cuatro horas", () => {
    const en3h = new Date(ahora.getTime() + 3 * 3_600_000);
    const estado = estadoDelPlazo(en3h, ahora);
    expect(estado.urgente).toBe(true);
    expect(estado.vencido).toBe(false);
    expect(estado.texto).toBe("Quedan 3 h");
  });

  it("con margen holgado no marca nada", () => {
    const en2dias = new Date(ahora.getTime() + 48 * 3_600_000);
    const estado = estadoDelPlazo(en2dias, ahora);
    expect(estado.urgente).toBe(false);
    expect(estado.texto).toBe("Quedan 2 días");
  });

  it("dice cuánto hace que se pasó", () => {
    const hace5h = new Date(ahora.getTime() - 5 * 3_600_000);
    const estado = estadoDelPlazo(hace5h, ahora);
    expect(estado.vencido).toBe(true);
    expect(estado.urgente).toBe(true);
    expect(estado.texto).toBe("Se pasó por 5 h");
  });

  it("en minutos cuando falta menos de una hora", () => {
    const en20min = new Date(ahora.getTime() + 20 * 60_000);
    expect(estadoDelPlazo(en20min, ahora).texto).toBe("Quedan 20 min");
  });
});
