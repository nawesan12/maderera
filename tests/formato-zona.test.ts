import { afterEach, describe, expect, it, vi } from "vitest";
import { fechaCorta, fechaHora, fechaLarga, hora } from "@/lib/formato";
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
