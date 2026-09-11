import { describe, expect, it } from "vitest";
import { enlaceDeWhatsapp, primerNombre, whatsappDestino } from "@/lib/formato";

/**
 * Las fichas del mostrador vienen con el título adelante —"Arq. Carolina
 * Méndez", "Ing. Silvia Roldán"— y quedarse con la primera palabra saludaba
 * "Hola, Arq.".
 *
 * Se probaba en tres lugares, pero el que justifica el test es el compositor de
 * plantillas de WhatsApp: ahí el saludo sale para afuera, al teléfono del
 * cliente, y no hay dónde verlo antes.
 */
describe("primerNombre", () => {
  it("saltea el título profesional", () => {
    expect(primerNombre("Arq. Carolina Méndez")).toBe("Carolina");
    expect(primerNombre("Ing. Silvia Roldán")).toBe("Silvia");
    expect(primerNombre("Dra. Ana Torres")).toBe("Ana");
  });

  it("lo saltea también sin el punto y en mayúsculas", () => {
    expect(primerNombre("ARQ Carolina Méndez")).toBe("Carolina");
    expect(primerNombre("lic maría paz")).toBe("maría");
  });

  it("deja intacto el nombre que no lleva título", () => {
    expect(primerNombre("Roberto Fernández")).toBe("Roberto");
    expect(primerNombre("Martín")).toBe("Martín");
  });

  it("prefiere un saludo formal a uno vacío", () => {
    // Una ficha cargada solo con el título es rara pero existe; saludar
    // "Hola, ." es peor que saludar "Hola, Arq.".
    expect(primerNombre("Arq.")).toBe("Arq.");
    expect(primerNombre("   ")).toBe("");
  });

  it("no confunde un nombre que empieza parecido a un título", () => {
    expect(primerNombre("Drago Pérez")).toBe("Drago");
    expect(primerNombre("Ingrid Sosa")).toBe("Ingrid");
  });
});

/**
 * El número que abre WhatsApp.
 *
 * Se prueba porque el error es invisible: un número sin el 9 abre una
 * conversación con alguien que no existe, y quien mandó el mensaje se queda
 * esperando una respuesta que nunca va a llegar. Estaba escrito en dos
 * pantallas y en las dos mal de distinta manera.
 */
describe("whatsappDestino", () => {
  it("agrega país y el 9 de celular", () => {
    expect(whatsappDestino("223-5544332")).toBe("5492235544332");
  });

  it("saca el 0 de larga distancia y el 15", () => {
    expect(whatsappDestino("0223 15-5544332")).toBe("5492235544332");
    expect(whatsappDestino("(0223) 155544332")).toBe("5492235544332");
  });

  it("respeta el que ya viene completo", () => {
    expect(whatsappDestino("5492235544332")).toBe("5492235544332");
    expect(whatsappDestino("+54 9 223 554-4332")).toBe("5492235544332");
  });

  it("le pone el 9 al que trae país sin celular", () => {
    expect(whatsappDestino("542235544332")).toBe("5492235544332");
  });

  it("arma el enlace con el mensaje escrito", () => {
    expect(enlaceDeWhatsapp("2235544332", "Hola")).toBe(
      "https://wa.me/5492235544332?text=Hola",
    );
    expect(enlaceDeWhatsapp("2235544332")).toBe("https://wa.me/5492235544332");
  });
});
