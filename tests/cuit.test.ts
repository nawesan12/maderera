import { describe, expect, it } from "vitest";
import {
  cuitValido,
  digitoVerificador,
  dniValido,
  documentoValido,
  formatearCuitLargo,
} from "@/lib/cuit";

/**
 * El CUIT lo tipea gente en el mostrador y en el alta de profesionales. Un
 * dígito mal deja una factura rechazada por ARCA y un alta que después no se
 * puede facturar.
 */
describe("cuitValido", () => {
  it("acepta CUIT bien formados", () => {
    expect(cuitValido("30-71234567-1")).toBe(true);
    expect(cuitValido("20123456786")).toBe(true);
    expect(cuitValido("27-12345678-0")).toBe(true);
  });

  it("rechaza el dígito verificador equivocado", () => {
    expect(cuitValido("30-71234567-9")).toBe(false);
  });

  it("rechaza largos que no sean once dígitos", () => {
    expect(cuitValido("3071234567")).toBe(false);
    expect(cuitValido("307123456781")).toBe(false);
  });

  it("rechaza prefijos que no existen", () => {
    expect(cuitValido("99-71234567-1")).toBe(false);
  });

  it("rechaza los rellenos habituales", () => {
    expect(cuitValido("00000000000")).toBe(false);
    expect(cuitValido("11111111111")).toBe(false);
  });

  it("rechaza vacío y nulo sin romperse", () => {
    expect(cuitValido("")).toBe(false);
    expect(cuitValido(null)).toBe(false);
    expect(cuitValido(undefined)).toBe(false);
  });

  it("acepta cualquier separador que use la gente", () => {
    expect(cuitValido("30 71234567 1")).toBe(true);
    expect(cuitValido("30.71234567.1")).toBe(true);
  });
});

describe("digitoVerificador", () => {
  it("necesita exactamente diez dígitos", () => {
    expect(digitoVerificador("123")).toBeNull();
  });

  it("devuelve un dígito entre 0 y 9", () => {
    const d = digitoVerificador("3071234567");
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThanOrEqual(9);
  });
});

describe("formatearCuitLargo", () => {
  it("pone los guiones", () => {
    expect(formatearCuitLargo("30712345671")).toBe("30-71234567-1");
  });

  it("deja intacto lo que no parece un CUIT", () => {
    expect(formatearCuitLargo("123")).toBe("123");
  });
});

/**
 * El DNI entró cuando el CUIT dejó de ser obligatorio en el alta de
 * profesionales. No tiene dígito verificador, así que lo único que se puede
 * exigir es la forma.
 */
describe("dniValido", () => {
  it("acepta siete y ocho dígitos", () => {
    expect(dniValido("28987654")).toBe(true);
    expect(dniValido("5123456")).toBe(true);
  });

  it("acepta los separadores que usa la gente", () => {
    expect(dniValido("28.987.654")).toBe(true);
  });

  it("rechaza lo que no tiene largo de documento", () => {
    expect(dniValido("123456")).toBe(false);
    expect(dniValido("123456789")).toBe(false);
    expect(dniValido("")).toBe(false);
    expect(dniValido(null)).toBe(false);
  });

  it("rechaza el relleno de dígitos repetidos", () => {
    expect(dniValido("00000000")).toBe(false);
    expect(dniValido("1111111")).toBe(false);
  });
});

/**
 * El número se valida contra el tipo con el que se presentó. Sin esto, un DNI
 * tipeado en el campo del CUIT pasaría, que es justo el error que el alta de
 * profesionales tiene que atrapar.
 */
describe("documentoValido", () => {
  it("exige CUIT cuando el tipo es CUIT", () => {
    expect(documentoValido("cuit", "30-71234567-1")).toBe(true);
    expect(documentoValido("cuit", "28987654")).toBe(false);
  });

  it("exige DNI cuando el tipo es DNI", () => {
    expect(documentoValido("dni", "28987654")).toBe(true);
    expect(documentoValido("dni", "30712345671")).toBe(false);
  });
});
