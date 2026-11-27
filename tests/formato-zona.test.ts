import { afterEach, describe, expect, it, vi } from "vitest";
import { claveDeMesAR, diaYMesAR, diasHasta, fechaCorta, fechaHora, fechaLarga, hora } from "@/lib/formato";
import { etiquetaDia, horaMensaje } from "@/app/admin/whatsapp/formato-wa";

// El servidor corre en UTC y el navegador en la Argentina: las horas tienen
// que salir iguales en los dos, en hora argentina.
describe("las horas, en hora argentina", () => {
  afterEach(() => vi.useRealTimers());

  it("hora y fechaHora no dependen de la zona de la máquina", () => {
    const instante = new Date("2026-10-31T02:30:00Z"); // 23:30 del 30 en la Argentina
    expect(hora.format(instante)).toBe("23:30");
    expect(fechaHora.format(instante)).toMatch(/^30\/10,? 23:30$/);
    expect(horaMensaje("2026-10-31T02:30:00Z")).toBe("23:30");
  });

  it("«Hoy» y «Ayer» de la bandeja cuentan el día argentino", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-31T02:00:00Z")); // 23:00 del 30
    expect(etiquetaDia("2026-10-30T22:00:00Z")).toBe("Hoy"); // 19:00 del 30
    expect(etiquetaDia("2026-10-30T01:00:00Z")).toBe("Ayer"); // 22:00 del 29
  });

  it("fechaCorta y fechaLarga: el día guardado como día, el instante en la Argentina", () => {
    // Un día cargado en un formulario: medianoche UTC. No se corre al 14.
    expect(fechaCorta.format(new Date("2026-10-15T00:00:00Z"))).toBe("15/10/26");
    expect(fechaLarga.format(new Date("2026-10-15T00:00:00Z"))).toBe("15 de octubre de 2026");
    // Un pedido de las 22:30 del 30: sigue siendo el 30, no el 31.
    expect(fechaCorta.format(new Date("2026-10-31T01:30:00Z"))).toBe("30/10/26");
    // Un instante de la tarde, igual que siempre.
    expect(fechaCorta.format(new Date("2026-10-30T18:00:00Z"))).toBe("30/10/26");
  });
});

// Mes simulado (H005/H061): la factura que vence hoy no está vencida, ni a la
// madrugada ni a la noche.
describe("diasHasta de un día guardado como día", () => {
  const vence = new Date("2026-11-26T00:00:00Z");
  it("vence hoy es 0 a cualquier hora del día argentino", () => {
    expect(diasHasta(vence, new Date("2026-11-26T03:40:00Z"))).toBe(0); // 00:40
    expect(diasHasta(vence, new Date("2026-11-27T02:30:00Z"))).toBe(0); // 23:30
  });
  it("ayer es −1 y mañana 1", () => {
    expect(diasHasta(vence, new Date("2026-11-27T03:10:00Z"))).toBe(-1);
    expect(diasHasta(vence, new Date("2026-11-25T23:00:00Z"))).toBe(1);
  });
});

// Un instante cuenta por el día argentino en que cae (mes simulado: el
// cheque de hoy al mediodía decía «en 1 día»).
describe("diasHasta de un instante", () => {
  it("hoy a cualquier hora es 0; mañana a la madrugada, 1", () => {
    const ahora = new Date("2026-11-26T12:30:00Z"); // 09:30
    expect(diasHasta(new Date("2026-11-26T15:00:00Z"), ahora)).toBe(0);
    expect(diasHasta(new Date("2026-11-27T02:59:00Z"), ahora)).toBe(0); // 23:59
    expect(diasHasta(new Date("2026-11-27T03:01:00Z"), ahora)).toBe(1);
    expect(diasHasta(new Date("2026-11-25T20:00:00Z"), ahora)).toBe(-1);
  });
});

// M2S2-023: los movimientos de la cuenta, en el día y el mes argentinos.
describe("los movimientos de la cuenta, en hora argentina", () => {
  it("lo cargado a las 21:05 del 26/11 es del 26/11", () => {
    expect(diaYMesAR.format(new Date("2026-11-27T00:05:00Z"))).toBe("26/11");
  });
  it("lo de las 22 h del 30/11 es de noviembre", () => {
    const noche = new Date("2026-12-01T01:00:00Z");
    expect(claveDeMesAR(noche)).toBe(claveDeMesAR(new Date("2026-11-15T15:00:00Z")));
    expect(claveDeMesAR(noche)).not.toBe(claveDeMesAR(new Date("2026-12-02T15:00:00Z")));
  });
});
