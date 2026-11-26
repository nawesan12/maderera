import { describe, expect, it } from "vitest";
import {
  enlaceDeWhatsapp,
  formatearMonto,
  formatearDecimal,
  formatearPeso,
  ABREVIATURA_UNIDAD,
  cantidadConUnidad,
  unidadConcordada,
  unidadDeVenta,
  documentoConTipo,
  formatearUnidad,
  primerNombre,
  whatsappDestino,
} from "@/lib/formato";
import { unitOfSale } from "@/lib/db/schema/catalog";

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

describe("formatearUnidad cubre todas las unidades de venta", () => {
  /**
   * El enum de la base es la lista de verdad.
   *
   * `tabla` se agregó cuando la clienta cambió la venta del deck y este mapa no
   * se enteró: la ficha del producto mostraba "tabla" porque el respaldo la
   * dejaba pasar tal cual, pero `kg` salía escrito "kg" de pura casualidad y
   * `metro_cubico` no está en el enum. Si alguien agrega una unidad, que falle
   * acá y no en la pantalla de un cliente.
   */
  it("no deja ninguna unidad del enum sin abreviatura propia", () => {
    const sinAbreviatura = unitOfSale.enumValues.filter(
      (u) => !(u in ABREVIATURA_UNIDAD),
    );
    expect(sinAbreviatura).toEqual([]);
  });

  it("nombra la tabla del deck", () => {
    expect(formatearUnidad("tabla")).toBe("tabla");
  });

  it("sin unidad no rompe", () => {
    expect(formatearUnidad(null)).toBe("u.");
  });
});

describe("formatearMonto (mes simulado, H034)", () => {
  it("muestra los centavos cuando los hay, como la cuenta del cliente", () => {
    expect(formatearMonto(203566.5)).toBe(formatearMonto("203566.50"));
    expect(formatearMonto(203566.5)).toMatch(/203\.566,50/);
    expect(formatearMonto(203567)).toMatch(/203\.567$/);
    expect(formatearMonto(0.1 + 0.2)).toMatch(/0,30/);
  });
});

describe("formatearPorcentaje", () => {
  it("va con coma decimal y un decimal", async () => {
    const { formatearPorcentaje } = await import("@/lib/formato");
    expect(formatearPorcentaje(12.54)).toBe("12,5%");
    expect(formatearPorcentaje(100)).toBe("100,0%");
    expect(formatearPorcentaje(-3.25)).toMatch(/^-3,[23]%$/);
  });
});

describe("formatearDecimal y formatearPeso (hallazgo 32)", () => {
  it("pone coma decimal y la cantidad fija de decimales", () => {
    expect(formatearDecimal(4.5, 1)).toBe("4,5");
    expect(formatearDecimal(4, 1)).toBe("4,0");
    expect(formatearDecimal(21, 2)).toBe("21,00");
    expect(formatearDecimal(0.333, 2)).toBe("0,33");
    expect(formatearDecimal(1234.5, 1)).toBe("1.234,5");
  });
  it("el peso de un archivo", () => {
    expect(formatearPeso(null)).toBe("");
    expect(formatearPeso(0)).toBe("");
    expect(formatearPeso(100)).toBe("1 KB");
    expect(formatearPeso(340 * 1024)).toBe("340 KB");
    expect(formatearPeso(1.5 * 1024 * 1024)).toBe("1,5 MB");
    expect(formatearPeso(40 * 1024 * 1024)).toBe("40,0 MB");
  });
});

describe("hayFiltro", () => {
  it("la página y los «todos» no son filtro", async () => {
    const { hayFiltro } = await import("@/lib/formato");
    expect(hayFiltro({})).toBe(false);
    expect(hayFiltro({ pagina: "2", estado: "todos", cat: "todas", buscar: "  " })).toBe(false);
    expect(hayFiltro({ buscar: "fenólico" })).toBe(true);
    expect(hayFiltro({ estado: "sin-stock" })).toBe(true);
  });
});

// «3 placas», no «3 placa»; la línea del corte dice «4 cortes» (simulación
// del mes, H095 y H145). El mes simulado también leyó «Quedan 25 placa».
describe("cantidadConUnidad", () => {
  it("concuerda la unidad con la cantidad", () => {
    expect(cantidadConUnidad(3, "placa")).toBe("3 placas");
    expect(cantidadConUnidad(1, "placa")).toBe("1 placa");
    expect(cantidadConUnidad(25, "placa")).toBe("25 placas");
    expect(cantidadConUnidad(6, "rollo")).toBe("6 rollos");
    expect(cantidadConUnidad(2, "par")).toBe("2 pares");
    expect(cantidadConUnidad(20, "unidad")).toBe("20 u.");
    expect(cantidadConUnidad(4, null)).toBe("4");
    expect(cantidadConUnidad(2.5, "metro_cuadrado")).toBe("2,5 m²");
    expect(cantidadConUnidad(4, "pasada")).toBe("4 cortes");
    // La ficha y Entregas dicen lo mismo que el remito (mes simulado, PED-1193).
    expect(cantidadConUnidad(20, "metro_lineal")).toBe("20 m");
    expect(cantidadConUnidad(19, "m")).toBe("19 m");
  });

  // H110: la lata se cuenta por lata en la firma, el remito, el stock y el mostrador.
  it("la lata de cuatro litros se cuenta por unidad", () => {
    expect(cantidadConUnidad(2, "litro", "Laca Poliuretánica — 4 litros — Brillante")).toBe("2 u.");
    expect(cantidadConUnidad(2, "litro", "Thinner suelto")).toBe("2 l");
    expect(unidadDeVenta("litro", "Laca 4 litros")).toBe("unidad");
    expect(unidadConcordada(119, "placa")).toBe("placas");
    expect(unidadConcordada(2.5, "placa")).toBe("placas");
    expect(unidadConcordada(22, "rollo")).toBe("rollos");
  });
});

describe("documentoConTipo", () => {
  // Un CUIT con guiones salía «DNI 30-71234567-8» (mes simulado).
  it("cuenta los dígitos", () => {
    expect(documentoConTipo("30-71234567-8")).toBe("CUIT 30-71234567-8");
    expect(documentoConTipo("20301112220")).toBe("CUIT 20-30111222-0");
    expect(documentoConTipo("30111222")).toBe("DNI 30.111.222");
  });
});
