import { describe, expect, it } from "vitest";
import { fechaDelTicket } from "@/lib/mostrador/ticket";

describe("fechaDelTicket", () => {
  it("dice la hora argentina, no la del servidor (mes simulado, H029)", () => {
    // 04:08 UTC es la 01:08 en Buenos Aires.
    expect(fechaDelTicket("2026-11-26T04:08:00.000Z")).toBe("26/11/26, 01:08");
  });

  it("una venta de las 22 no sale con el día siguiente", () => {
    expect(fechaDelTicket("2026-11-27T01:30:00.000Z")).toBe("26/11/26, 22:30");
  });
});
