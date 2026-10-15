import { describe, expect, it } from "vitest";
import {
  armarAvisoManual,
  AVISOS_MANUALES,
  cuerpoDePlantilla,
  enlaceWaMe,
  esEventoManual,
} from "@/lib/whatsapp/aviso-manual";
import {
  calcularGasto,
  categoriaDeTarifa,
  dolares,
  estadoDelTope,
  inicioDelMesArgentino,
  inicioDelMesSiguienteArgentino,
  mesArgentino,
  TARIFAS_POR_OMISION,
  tarifasEfectivas,
  umbralesPasados,
} from "@/lib/whatsapp/costos";

/** Lo que va después de `?text=`, decodificado. */
function textoDe(href: string | null): string {
  const url = new URL(href!);
  return url.searchParams.get("text") ?? "";
}

describe("aviso manual: el texto sale de la plantilla", () => {
  it("cada aviso manual apunta a una plantilla que existe", () => {
    for (const [evento, { plantilla }] of Object.entries(AVISOS_MANUALES)) {
      expect(cuerpoDePlantilla(plantilla), evento).toBeTruthy();
    }
  });

  it("pedido listo: el texto exacto de la plantilla, completo, y el enlace de seguimiento", () => {
    const aviso = armarAvisoManual({
      evento: "listo",
      nombre: "Marta Gómez",
      telefono: "(0223) 15-555-0123",
      valores: { pedido: "PED-1207", sucursal: "Casa Central, Av. Juan B. Justo 4153", horario: "de lunes a viernes de 8 a 16" },
      enlace: { texto: "Para ver tu pedido", url: "https://mjbj.com.ar/pedido/PED-1207?t=abc" },
    });
    expect(aviso.motivo).toBeNull();
    expect(aviso.texto).toBe(
      "Hola Marta, tu pedido PED-1207 ya está listo para retirar en Casa Central, Av. Juan B. Justo 4153. " +
        "El horario es de lunes a viernes de 8 a 16. Si lo retira otra persona, avisanos por acá." +
        "\n\nPara ver tu pedido: https://mjbj.com.ar/pedido/PED-1207?t=abc",
    );
    expect(aviso.telefono).toBe("+54 9 223 555-0123");
  });

  it("el número va con el 549 y el texto codificado entero", () => {
    const aviso = armarAvisoManual({
      evento: "corte_listo",
      nombre: "José",
      telefono: "223 555-0123",
      valores: { corte: "COR-0412", sucursal: "Aserradero" },
    });
    expect(aviso.href).toMatch(/^https:\/\/wa\.me\/5492235550123\?text=/);
    // Ni espacios ni acentos sin codificar: wa.me los corta.
    expect(aviso.href).not.toMatch(/[ áéíóúñ\n]/);
    expect(aviso.href).toContain("Hola%20Jos%C3%A9%2C%20tu%20trabajo%20de%20corte%20COR-0412");
    expect(textoDe(aviso.href)).toBe(aviso.texto);
  });

  it("los saltos de línea y los signos viajan codificados", () => {
    const href = enlaceWaMe("+54 9 223 590-3118", "¿Seguimos?\n\nVer: https://x.com/a?t=1&b=2");
    expect(href).toBe(
      "https://wa.me/5492235903118?text=%C2%BFSeguimos%3F%0A%0AVer%3A%20https%3A%2F%2Fx.com%2Fa%3Ft%3D1%26b%3D2",
    );
  });

  it("sin nombre saluda como el automático", () => {
    const aviso = armarAvisoManual({ evento: "entregado", nombre: "", telefono: "2235550123", valores: { pedido: "PED-1" } });
    expect(aviso.texto.startsWith("Hola qué tal, entregamos tu pedido PED-1.")).toBe(true);
  });

  it("si falta un dato, se saca la oración en vez de dejar el {{hueco}}", () => {
    const aviso = armarAvisoManual({
      evento: "listo",
      nombre: "Ana",
      telefono: "2235550123",
      valores: { pedido: "PED-9", sucursal: "Aserradero", horario: "" },
    });
    expect(aviso.texto).not.toContain("{{");
    expect(aviso.texto).not.toContain("El horario es");
    expect(aviso.texto).toContain("Si lo retira otra persona");
  });

  it("sin teléfono no hay enlace, y dice por qué", () => {
    const aviso = armarAvisoManual({ evento: "listo", nombre: "Ana", telefono: null, valores: { pedido: "PED-9" } });
    expect(aviso.href).toBeNull();
    expect(aviso.motivo).toMatch(/no tiene teléfono/);
  });

  it("con un teléfono que no se entiende, tampoco", () => {
    const aviso = armarAvisoManual({ evento: "listo", nombre: "Ana", telefono: "123", valores: { pedido: "PED-9" } });
    expect(aviso.href).toBeNull();
    expect(aviso.motivo).toMatch(/«123» no parece/);
    expect(enlaceWaMe("sin número")).toBeNull();
  });

  it("solo los eventos conocidos", () => {
    expect(esEventoManual("listo")).toBe(true);
    expect(esEventoManual("toString")).toBe(false);
    expect(esEventoManual("inventado")).toBe(false);
  });
});

describe("gasto del mes", () => {
  it("mapea las subcategorías de Meta a su tarifa", () => {
    expect(categoriaDeTarifa("marketing_lite")).toBe("marketing");
    expect(categoriaDeTarifa("authentication_international")).toBe("authentication");
    expect(categoriaDeTarifa("utility")).toBe("utility");
    expect(categoriaDeTarifa("service")).toBe("service");
    expect(categoriaDeTarifa("referral_conversion")).toBeNull();
    // Lo que no se conoce, se estima de más.
    expect(categoriaDeTarifa("algo_nuevo")).toBe("service");
  });

  it("suma lo cobrable con su tarifa, no cuenta lo gratis y separa lo estimado", () => {
    const gasto = calcularGasto(
      [
        { categoria: "utility", cobrable: true, total: 100 },
        { categoria: "utility", cobrable: false, total: 7 },
        { categoria: "service", cobrable: true, total: 10 },
        { categoria: "marketing", cobrable: true, total: 3 },
        { categoria: "service", cobrable: null, total: 2, estimado: true },
        { categoria: "referral_conversion", cobrable: true, total: 50 },
      ],
      TARIFAS_POR_OMISION,
    );
    expect(gasto.usdConfirmado).toBeCloseTo(100 * 0.026 + 10 * 0.026 + 3 * 0.0618, 6);
    expect(gasto.usdEstimado).toBeCloseTo(2 * 0.026, 6);
    expect(gasto.usd).toBeCloseTo(gasto.usdConfirmado + gasto.usdEstimado, 6);
    expect(gasto.porCategoria.utility).toEqual({ gratis: 7, cobrados: 100, estimados: 0, usd: 2.6 });
    expect(gasto.porCategoria.service.estimados).toBe(2);
  });

  it("300 avisos de pedido listo son USD 7,80", () => {
    const gasto = calcularGasto([{ categoria: "utility", cobrable: true, total: 300 }], TARIFAS_POR_OMISION);
    expect(gasto.usd).toBe(7.8);
    expect(dolares(gasto.usd)).toBe("USD 7,80");
  });

  it("las tarifas guardadas pisan las de siempre, y lo raro se ignora", () => {
    const t = tarifasEfectivas({ utility: 0.03, marketing: "x", service: -1, authentication: 99 });
    expect(t).toEqual({ ...TARIFAS_POR_OMISION, utility: 0.03 });
    expect(tarifasEfectivas(null)).toEqual(TARIFAS_POR_OMISION);
  });
});

describe("tope y umbrales", () => {
  it("80 % y 100 %", () => {
    expect(estadoDelTope(7.99, 10)).toMatchObject({ alcanzado: false, umbral: null });
    expect(estadoDelTope(8, 10)).toMatchObject({ alcanzado: false, umbral: 80 });
    expect(estadoDelTope(10, 10)).toMatchObject({ alcanzado: true, umbral: 100 });
    expect(estadoDelTope(12.5, 10).proporcion).toBeCloseTo(1.25);
    expect(umbralesPasados(5, 10)).toEqual([]);
    expect(umbralesPasados(8.5, 10)).toEqual([80]);
    expect(umbralesPasados(11, 10)).toEqual([80, 100]);
  });

  it("un tope de cero es «por la API, nada»", () => {
    expect(estadoDelTope(0, 0)).toMatchObject({ alcanzado: true, umbral: 100 });
  });
});

describe("el mes es el de Argentina", () => {
  it("las 22 del 31/10 en Mar del Plata ya son noviembre en UTC, pero el mes sigue siendo octubre", () => {
    const noche = new Date("2026-11-01T01:00:00Z"); // 31/10 22:00 en Argentina
    expect(mesArgentino(noche)).toBe("2026-10");
    expect(inicioDelMesArgentino(noche).toISOString()).toBe("2026-10-01T03:00:00.000Z");
    expect(inicioDelMesSiguienteArgentino(noche).toISOString()).toBe("2026-11-01T03:00:00.000Z");
  });

  it("a las 00:30 del 1/11 en Argentina ya es noviembre", () => {
    const madrugada = new Date("2026-11-01T03:30:00Z");
    expect(mesArgentino(madrugada)).toBe("2026-11");
    expect(inicioDelMesArgentino(madrugada).toISOString()).toBe("2026-11-01T03:00:00.000Z");
  });

  it("diciembre pasa al año siguiente", () => {
    expect(inicioDelMesSiguienteArgentino(new Date("2026-12-15T12:00:00Z")).toISOString()).toBe("2027-01-01T03:00:00.000Z");
  });
});
