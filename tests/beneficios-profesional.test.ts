import { describe, expect, it } from "vitest";
import {
  CUENTA_PROFESIONAL_EN_EL_ASISTENTE,
  bajadaDelProfesional,
  bannerDelProfesional,
  beneficiosDelProfesional,
} from "@/lib/profesionales/beneficios";
import { pasoPorId } from "@/lib/asistente/guion";
import { DONDE_SE_CORTA, SUCURSALES, dondeSeCortaAlEmpezar } from "@/lib/sucursales";

describe("lo que promete la página de profesionales (hallazgo 28)", () => {
  it("con la tienda apagada no promete precios de gremio ni plazos", () => {
    const texto = JSON.stringify(beneficiosDelProfesional(false)) + bajadaDelProfesional(false);
    expect(texto.toLowerCase()).not.toContain("gremio");
    expect(texto).not.toMatch(/24\s*h/);
  });

  it("la portada y el asistente siguen la misma regla", () => {
    const textos = [
      JSON.stringify(bannerDelProfesional(false)),
      CUENTA_PROFESIONAL_EN_EL_ASISTENTE,
      pasoPorId("profesionales")!.mensaje,
    ].join(" ").toLowerCase();
    expect(textos).not.toContain("gremio");
    expect(textos).not.toContain("lista de precios");
    expect(textos).not.toContain("descuento");
  });

  it("con la tienda apagada el presupuesto va a WhatsApp", () => {
    const presupuesto = beneficiosDelProfesional(false).find((b) => b.clave === "presupuesto");
    expect(presupuesto?.aWhatsapp).toBe(true);
    expect(presupuesto?.titulo).toBe("Presupuesto por WhatsApp");
  });

  it("con la tienda encendida queda como estaba", () => {
    expect(beneficiosDelProfesional(true).map((b) => b.clave)).toEqual([
      "precios",
      "cuenta",
      "presupuesto",
      "documentacion",
    ]);
  });
});

describe("dónde se corta (hallazgo 46)", () => {
  it("la sucursal del corte existe", () => {
    expect(SUCURSALES.map((s) => s.slug)).toContain(DONDE_SE_CORTA.sucursal);
  });

  it("la frase empieza en minúscula y tiene su versión de comienzo de renglón", () => {
    expect(DONDE_SE_CORTA.frase).toMatch(/^[a-z]/);
    expect(dondeSeCortaAlEmpezar()).toBe("En el aserradero");
  });
});
