import { describe, expect, it } from "vitest";
import { periodoDe } from "@/lib/tareas/periodo";
import { esperaParaElIntento } from "@/lib/cola/espera";

/**
 * Las tareas programadas y la cola de trabajos.
 *
 * El período es el candado que evita correr dos veces lo mismo: si estuviera
 * en UTC, la corrida de las 22 h de Buenos Aires ya contaría como «mañana».
 */
describe("el período de una tarea", () => {
  it("es el día de Buenos Aires, no el de UTC", () => {
    // 1/10 a las 23:30 en Buenos Aires = 2/10 02:30 UTC.
    const noche = new Date("2026-10-02T02:30:00Z");
    expect(periodoDe("dia", noche)).toBe("2026-10-01");
    expect(periodoDe("hora", noche)).toBe("2026-10-01T23");
  });

  it("la semana es la ISO, también en el cambio de año", () => {
    expect(periodoDe("semana", new Date("2026-10-01T15:00:00Z"))).toBe("2026-W40");
    // 1/1/2027 es viernes: pertenece a la semana 53 de 2026.
    expect(periodoDe("semana", new Date("2027-01-01T15:00:00Z"))).toBe("2026-W53");
    expect(periodoDe("semana", new Date("2027-01-04T15:00:00Z"))).toBe("2027-W01");
  });
});

describe("la espera entre reintentos", () => {
  it("se duplica y se planta en una hora", () => {
    expect(esperaParaElIntento(1)).toBe(30_000);
    expect(esperaParaElIntento(2)).toBe(60_000);
    expect(esperaParaElIntento(4)).toBe(240_000);
    expect(esperaParaElIntento(20)).toBe(3_600_000);
  });
});
