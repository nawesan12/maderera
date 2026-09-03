import { describe, expect, it } from "vitest";
import { consultaLimpia, entender, normalizar } from "@/lib/asistente/lenguaje";

/**
 * Lo que la gente escribe de verdad, no lo que uno imagina que va a escribir.
 *
 * Estos casos son el contrato del asistente: si mañana alguien agrega una
 * palabra a las listas y rompe uno, es que cambió qué entiende, y eso se tiene
 * que ver acá antes que en el sitio.
 */
describe("normalizar", () => {
  it("saca acentos y mayúsculas, como f_unaccent en la base", () => {
    expect(normalizar("Fenólico")).toBe("fenolico");
    expect(normalizar("MELAMÍNICA")).toBe("melaminica");
    expect(normalizar("  cañería   ")).toBe("caneria");
  });

  it("conserva lo que hace falta para leer medidas", () => {
    expect(normalizar("2440x1220")).toBe("2440x1220");
    expect(normalizar("18 mm.")).toBe("18 mm.");
  });
});

describe("consultaLimpia", () => {
  it("saca las muletillas y deja lo que sirve para buscar", () => {
    expect(consultaLimpia("hola, necesito una placa de melamina")).toBe(
      "placa melamina",
    );
    expect(consultaLimpia("¿cuánto sale el fenólico?")).toBe("fenolico");
  });

  it("no devuelve nada cuando no hay nada que buscar", () => {
    expect(consultaLimpia("hola buenas")).toBe("");
    expect(consultaLimpia("gracias!")).toBe("");
  });
});

describe("entender", () => {
  it("reconoce un saludo pelado", () => {
    expect(entender("hola").intencion).toBe("saludo");
    expect(entender("buenas tardes").intencion).toBe("saludo");
  });

  it("un saludo con una pregunta atrás es la pregunta", () => {
    // Lo más común de todo: nadie saluda y espera.
    expect(entender("hola, tenés melamina blanca?").intencion).toBe("buscar");
  });

  it.each([
    ["hacen envíos a Mar del Plata?", "envios"],
    ["me lo mandan a domicilio?", "envios"],
    ["cuánto sale el flete", "envios"],
    ["a qué hora abren?", "horarios"],
    ["dónde queda el local", "horarios"],
    ["puedo pagar con tarjeta en cuotas?", "pagos"],
    ["aceptan transferencia", "pagos"],
    ["me lo cortan a medida?", "cortes"],
    ["quiero mandar un despiece", "cortes"],
    ["se puede tener cuenta corriente?", "cuenta"],
    ["soy carpintero, tienen precios mayoristas", "cuenta"],
    ["quiero hablar con una persona", "persona"],
    ["cuánto material necesito para un techo", "calcular"],
  ])("entiende %s", (frase, esperada) => {
    expect(entender(frase).intencion).toBe(esperada);
  });

  it("nombrar un producto gana sobre la palabra precio", () => {
    // La respuesta útil es el producto con su precio, no la lista de medios
    // de pago.
    const r = entender("cuánto sale el fenólico de 18");
    expect(r.intencion).toBe("buscar");
    expect(r.consulta).toContain("fenolico");
    expect(r.medida.espesorMm).toBe(18);
  });

  it("«tenés melamina» busca, no recita el stock", () => {
    const r = entender("tenés melamina de 18?");
    expect(r.intencion).toBe("buscar");
    expect(r.rubro).toBe("placas");
  });

  it("lee el espesor de varias formas", () => {
    expect(entender("fenólico 18mm").medida.espesorMm).toBe(18);
    expect(entender("melamina de 15").medida.espesorMm).toBe(15);
    expect(entender("placa de 5 mm").medida.espesorMm).toBe(5);
  });

  it("no confunde una medida grande con un espesor", () => {
    // «2600» es el largo de una placa, no un grosor.
    const r = entender("placa 1830 x 2600");
    expect(r.medida.largoMm).toBe(1830);
    expect(r.medida.anchoMm).toBe(2600);
    expect(r.medida.espesorMm).toBeUndefined();
  });

  it("lee metros cuadrados y metros lineales", () => {
    expect(entender("necesito 40 m2 de piso").cantidad).toEqual({
      valor: 40,
      unidad: "m2",
    });
    expect(entender("12 metros de zócalo").cantidad).toEqual({
      valor: 12,
      unidad: "m",
    });
  });

  it("reconoce el rubro por como lo dice la gente", () => {
    // Nadie escribe "construcción en seco".
    expect(entender("necesito durlock").rubro).toBe("construccion-en-seco");
    expect(entender("busco chapa para el techo").rubro).toBe("cubiertas");
    expect(entender("tornillos").rubro).toBe("ferreteria");
  });

  it("admite no entender en vez de inventar", () => {
    const r = entender("qwerty zxcv");
    // Cae en buscar porque hay texto que se puede consultar; lo importante es
    // que no se invente una intención de negocio.
    expect(["buscar", "sin_idea"]).toContain(r.intencion);
  });

  it("un texto vacío no rompe nada", () => {
    const r = entender("   ");
    expect(r.intencion).toBe("sin_idea");
    expect(r.consulta).toBe("");
  });
});
