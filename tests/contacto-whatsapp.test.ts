import { describe, expect, it } from "vitest";
import { textoDeContacto } from "@/lib/contacto/consulta";
import { enlaceDeConsulta } from "@/lib/catalogo/consulta";

/*
 * Si el correo no salió, «Prefiero WhatsApp» abre el chat con lo que ya se
 * escribió en el formulario (corrección de T5).
 */
describe("el WhatsApp del contacto lleva lo escrito", () => {
  it("nombre, motivo y mensaje", () => {
    expect(
      textoDeContacto({ nombre: "Juan", motivo: "presupuesto", mensaje: "12 placas de fenólico de 18", telefono: "223 15 123-4567" }),
    ).toBe("Hola! Soy Juan. Pedido de presupuesto: 12 placas de fenólico de 18");
  });

  it("sin nombre ni motivo conocido, el mensaje solo", () => {
    expect(textoDeContacto({ mensaje: "¿Tienen OSB?", motivo: "raro" })).toBe("Hola! ¿Tienen OSB?");
  });

  it("sin mensaje no hay texto: el chat se abre como siempre", () => {
    expect(textoDeContacto({ nombre: "Juan", mensaje: "  " })).toBeNull();
    expect(textoDeContacto(undefined)).toBeNull();
  });

  it("el enlace lleva el texto codificado", () => {
    const enlace = enlaceDeConsulta("5492235903118", textoDeContacto({ mensaje: "2 × 3 m²" })!);
    expect(decodeURIComponent(enlace.split("?text=")[1])).toBe("Hola! 2 × 3 m²");
  });
});
