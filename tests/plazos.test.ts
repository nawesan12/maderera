import { describe, expect, it } from "vitest";
import { estadoDelPlazo, vencimientoDelDia, vencimientoExpress } from "@/lib/plazos";

/**
 * Dos compromisos distintos: el express del portal profesional, a 24 horas, y
 * el general del brief, que es **el mismo día**. Contarlos mal hace que el
 * panel muestre en rojo cosas que están a tiempo, y a los tres días nadie mira
 * el indicador.
 *
 * El sábado es media jornada de atención (8 a 12), no un día cerrado.
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

  it("un pedido del viernes a la tarde vence el sábado al mediodía", () => {
    // El sábado se atiende de 8 a 12, así que las 24 horas caen dentro de una
    // jornada real. Antes se corría al lunes: tres días para algo que en el
    // local se contesta el sábado a la mañana.
    const viernes15 = new Date(2026, 7, 28, 15, 0, 0);
    const r = vencimientoExpress(viernes15);
    expect(r.getDay()).toBe(6);
    expect(r.getHours()).toBe(12);
  });

  it("un pedido del sábado vence el lunes, porque el domingo está cerrado", () => {
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


describe("vencimientoDelDia", () => {
  it("vence al cierre del mismo día", () => {
    const r = vencimientoDelDia(lunes10);
    expect(r.getDate()).toBe(24);
    expect(r.getHours()).toBe(16);
  });

  it("el sábado vence al mediodía", () => {
    const sabado9 = new Date(2026, 7, 29, 9, 0, 0);
    const r = vencimientoDelDia(sabado9);
    expect(r.getDay()).toBe(6);
    expect(r.getHours()).toBe(12);
  });

  it("después del cierre el compromiso pasa al día siguiente", () => {
    // Prometer "hoy" a las once de la noche es prometer algo que ya no se
    // puede cumplir.
    const lunes23 = new Date(2026, 7, 24, 23, 0, 0);
    const r = vencimientoDelDia(lunes23);
    expect(r.getDate()).toBe(25);
  });

  it("un domingo se compromete para el lunes", () => {
    const domingo = new Date(2026, 7, 30, 10, 0, 0);
    const r = vencimientoDelDia(domingo);
    expect(r.getDay()).toBe(1);
  });
});
