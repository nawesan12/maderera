import { describe, expect, it } from "vitest";
import { fechaHora } from "@/lib/formato";
import { fechaDelRemito, fechaHoraDeFirma } from "@/lib/entregas/fecha";

describe("la fecha de la firma del remito", () => {
  it("sale en hora de Argentina aunque el servidor esté en UTC", () => {
    // 00:05 del 30/10 en Argentina son las 03:05 UTC; 22:30 del 29 son las
    // 01:30 UTC del 30.
    expect(fechaHoraDeFirma.format(new Date("2026-10-30T03:05:00Z"))).toBe("30/10, 00:05");
    expect(fechaHoraDeFirma.format(new Date("2026-10-30T01:30:00Z"))).toBe("29/10, 22:30");
  });

  it("fechaHora de lib/formato tampoco depende de la zona del servidor", () => {
    // Antes no fijaba la zona y con TZ=UTC (como Next en producción) daba
    // las 03:05. Ahora la fija: da lo mismo que la de la firma en cualquier
    // máquina. La prueba vieja afirmaba la hora corrida y solo corría en UTC,
    // así que pasaba en la Mac y fallaba en la CI.
    const instante = new Date("2026-10-30T03:05:00Z");
    expect(fechaHora.format(instante)).toBe("30/10, 00:05");
    expect(fechaHora.format(instante)).toBe(fechaHoraDeFirma.format(instante));
  });

  it("la fecha del remito impreso es la de Argentina, como en el PDF", () => {
    // Un remito de las 22:30 del 29 no puede decir 30.
    expect(fechaDelRemito.format(new Date("2026-10-30T01:30:00Z"))).toBe("29/10/26");
  });
});
