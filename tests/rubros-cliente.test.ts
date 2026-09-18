import { describe, expect, it } from "vitest";
import {
  etiquetaDeRubro,
  normalizarRubro,
  RUBROS_CLIENTE,
} from "@/lib/rubros-cliente";

/**
 * El rubro del cliente.
 *
 * Se prueba la normalización porque `customers.rubro` fue texto libre durante
 * toda la primera etapa: la cartera trae «Carpintero», «carpinteria» y
 * «CARPINTERÍA» escritos por tres personas distintas, y un filtro por rubro que
 * los trate como tres rubros distintos no sirve para nada —que es justo para lo
 * que la clienta lo pidió: ver cómo crece cada gremio—.
 */
describe("catálogo de rubros", () => {
  it("tiene los que dictó la clienta", () => {
    const valores = RUBROS_CLIENTE.map((r) => r.valor);
    for (const esperado of [
      "arquitecto",
      "carpintero",
      "cementista",
      "constructora",
      "moldava",
      "woodframer",
    ]) {
      expect(valores).toContain(esperado);
    }
  });

  it("particular no es un rubro profesional", () => {
    // Era el argumento de la clienta para sacar «tipo de cliente»: un
    // consumidor final no tiene rubro.
    const particular = RUBROS_CLIENTE.find((r) => r.valor === "particular");
    expect(particular?.esProfesional).toBe(false);
  });
});

describe("cómo se muestra", () => {
  it("usa la etiqueta del catálogo", () => {
    expect(etiquetaDeRubro("woodframer")).toBe("Wood frame");
  });

  it("sin rubro lo dice", () => {
    expect(etiquetaDeRubro(null)).toBe("Sin rubro");
    expect(etiquetaDeRubro("")).toBe("Sin rubro");
  });

  it("lo que no conoce lo muestra igual", () => {
    // La migración del sistema viejo puede traer cualquier cosa: esconderla
    // sería perder el dato.
    expect(etiquetaDeRubro("Aserradero")).toBe("Aserradero");
  });
});

describe("normalizar lo escrito a mano", () => {
  it("junta las variantes de un mismo rubro", () => {
    for (const escrito of ["Carpintero", "carpinteria", "CARPINTERÍA"]) {
      expect(normalizarRubro(escrito)).toBe("carpintero");
    }
  });

  it("reconoce los acentos y las mayúsculas", () => {
    expect(normalizarRubro("Diseño de interiores")).toBe("disenador");
    expect(normalizarRubro("ARQUITECTO")).toBe("arquitecto");
  });

  it("trata al consumidor final como particular", () => {
    expect(normalizarRubro("consumidor final")).toBe("particular");
  });

  it("deja pasar lo que no reconoce, sin perderlo", () => {
    expect(normalizarRubro("Aserradero")).toBe("Aserradero");
  });

  it("vacío es sin rubro", () => {
    expect(normalizarRubro("")).toBeNull();
    expect(normalizarRubro("   ")).toBeNull();
    expect(normalizarRubro(null)).toBeNull();
  });
});
