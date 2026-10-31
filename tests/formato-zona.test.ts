import { afterEach, describe, expect, it, vi } from "vitest";
import { fechaHora, hora } from "@/lib/formato";
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
});
