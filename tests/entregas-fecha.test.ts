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

  it("el formateador de antes dependía de la zona del servidor", () => {
    // Con TZ=UTC (como Next en producción) daba la hora corrida.
    if (new Date().getTimezoneOffset() !== 0) return;
    expect(fechaHora.format(new Date("2026-10-30T03:05:00Z"))).toBe("30/10, 03:05");
  });

  it("la fecha del remito impreso es la de Argentina, como en el PDF", () => {
    // Un remito de las 22:30 del 29 no puede decir 30.
    expect(fechaDelRemito.format(new Date("2026-10-30T01:30:00Z"))).toBe("29/10/26");
  });
});
