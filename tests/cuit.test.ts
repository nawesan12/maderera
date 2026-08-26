import { describe, expect, it } from "vitest";
import { cuitValido, digitoVerificador, formatearCuitLargo } from "@/lib/cuit";

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
