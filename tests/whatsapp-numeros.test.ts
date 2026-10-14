import { describe, expect, it } from "vitest";
import {
  aWaId,
  jidDeWaId,
  mismoNumero,
  numeroLegible,
  numeroNacional,
  waIdDeMeta,
} from "@/lib/whatsapp/numeros";

/**
 * El mismo celular escrito de todas las formas en que aparece en las fichas.
 * Si alguna no da el mismo número, ese cliente queda con dos conversaciones o
 * sin ficha, y quien atiende no ve su deuda.
 */
describe("numeroNacional", () => {
  const formas = [
    "5492235903118",
    "542235903118", // el formato viejo, sin el 9
    "+54 9 223 590-3118",
    "+54 223 590 3118",
    "(0223) 15-590-3118",
    "0223 15 5903118",
    "223 15 590 3118",
    "223 590-3118",
    "2235903118",
    "590-3118", // sin característica: Mar del Plata
    "15 590-3118",
    "0054 9 223 590 3118",
  ];

  for (const forma of formas) {
    it(`«${forma}» es 2235903118`, () => {
      expect(numeroNacional(forma)).toBe("2235903118");
    });
  }

  it("respeta las características de 2 y 4 dígitos", () => {
    expect(numeroNacional("011 15 4567-8901")).toBe("1145678901");
    expect(numeroNacional("+54 9 11 4567-8901")).toBe("1145678901");
    expect(numeroNacional("02266 15 412345")).toBe("2266412345");
  });

  it("no inventa un número con lo que no lo es", () => {
    expect(numeroNacional("123")).toBeNull();
    expect(numeroNacional("+1 415 555 0100")).toBeNull();
    expect(numeroNacional("")).toBeNull();
  });
});

describe("aWaId y waIdDeMeta", () => {
  it("pone el 9 de los celulares argentinos", () => {
    expect(aWaId("223 590-3118")).toBe("5492235903118");
    expect(aWaId("542235903118")).toBe("5492235903118");
  });

  it("un número extranjero con + se respeta", () => {
    expect(aWaId("+1 415 555 0100")).toBe("14155550100");
    expect(aWaId("+598 99 123 456")).toBe("59899123456");
  });

  it("el wa_id de Meta, con o sin el 9, cae en la misma conversación", () => {
    expect(waIdDeMeta("5492235903118")).toBe("5492235903118");
    expect(waIdDeMeta("542235903118")).toBe("5492235903118");
    expect(jidDeWaId("542235903118")).toBe("5492235903118@s.whatsapp.net");
    expect(waIdDeMeta("14155550100")).toBe("14155550100");
  });
});

describe("mismoNumero", () => {
  it("compara por número y no por cómo se escribió", () => {
    expect(mismoNumero("(0223) 15-590-3118", "5492235903118@s.whatsapp.net".split("@")[0])).toBe(true);
    expect(mismoNumero("223 590-3118", "223 590-3119")).toBe(false);
  });

  it("dos números de distinta ciudad con los mismos últimos dígitos no son el mismo", () => {
    // Comparar los últimos ocho dígitos, como se hacía, los confundía.
    expect(mismoNumero("011 3590-3118", "0223 590-3118")).toBe(false);
  });
});

describe("numeroLegible", () => {
  it("lo muestra como se dicta", () => {
    expect(numeroLegible("5492235903118@s.whatsapp.net")).toBe("+54 9 223 590-3118");
    expect(numeroLegible("5491145678901")).toBe("+54 9 11 4567-8901");
  });
});
