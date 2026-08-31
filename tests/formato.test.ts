import { describe, expect, it } from "vitest";
import { primerNombre } from "@/lib/formato";

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
