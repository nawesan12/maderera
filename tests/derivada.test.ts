import { describe, expect, it } from "vitest";
import { factorDeLista } from "@/lib/precios/derivada";

/**
 * El multiplicador de una lista derivada (la constructora: "general − N %").
 * Multiplica el catálogo entero, así que el acote importa más que la cuenta.
 */
describe("factorDeLista", () => {
  it("convierte el porcentaje en multiplicador", () => {
    expect(factorDeLista(-5)).toBe(0.95);
    expect(factorDeLista("-10.00")).toBe(0.9);
    expect(factorDeLista(10)).toBe(1.1);
  });

  it("sin porcentaje, la lista no deriva nada", () => {
    expect(factorDeLista(null)).toBe(1);
    expect(factorDeLista(0)).toBe(1);
    expect(factorDeLista("")).toBe(1);
  });

  it("acota el error de tipeo: ni regalar ni duplicar el catálogo", () => {
    // Un "-90" tipeado con un cero de más no publica todo al 10 % del valor.
    expect(factorDeLista(-90)).toBe(0.5);
    expect(factorDeLista(500)).toBe(2);
  });

  it("un valor roto no rompe el precio", () => {
    expect(factorDeLista("no-es-numero")).toBe(1);
  });
});
