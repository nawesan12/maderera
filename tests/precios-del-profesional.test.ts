import { describe, expect, it } from "vitest";
import { preciosDelProfesional } from "@/lib/tienda";

// H086: qué accesos con precios ve el profesional en /profesionales.
describe("precios del profesional", () => {
  const encendida = { activa: true, stockVisible: true };
  const apagada = { activa: false, stockVisible: true };
  it("con la tienda encendida, siempre", () => {
    expect(preciosDelProfesional(encendida, "no", false)).toBe(true);
  });
  it("apagada, solo con la regla y una lista propia", () => {
    expect(preciosDelProfesional(apagada, "no", true)).toBe(false);
    expect(preciosDelProfesional(apagada, "si", false)).toBe(false);
    expect(preciosDelProfesional(apagada, "si", true)).toBe(true);
  });
});
