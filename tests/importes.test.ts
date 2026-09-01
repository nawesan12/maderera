import { describe, expect, it } from "vitest";
import { parsearImporte } from "@/lib/formato";

/**
 * El defecto que ya ocurrió: el parseo quitaba todos los puntos asumiendo
 * formato argentino y convertía un cobro de $528.300 en uno de $52.830.000.
 *
 * El mismo error estaba latente en los movimientos de cuenta corriente, así que
 * este archivo existe para que no vuelva por ninguno de los dos lados.
 */
describe("parsearImporte", () => {
  it("lee el formato argentino: la coma es decimal", () => {
    expect(parsearImporte("528.300,50")).toBe(528300.5);
    expect(parsearImporte("1.234.567,89")).toBe(1234567.89);
    expect(parsearImporte("0,05")).toBe(0.05);
  });

  it("lee el formato del navegador: sin coma, el punto es decimal", () => {
    expect(parsearImporte("528300.00")).toBe(528300);
    expect(parsearImporte("1234.56")).toBe(1234.56);
  });

  it("NO convierte 528.300 en 52.830.000", () => {
    // El caso exacto del defecto. Sin coma, el punto es decimal.
    expect(parsearImporte("528.300")).toBe(528.3);
    expect(parsearImporte("528.300")).not.toBe(52830000);
  });

  it("con más de un punto, todos son de miles", () => {
    // "1.500.000" no tiene lectura decimal posible: dos puntos no son un
    // número. Es la forma en que se tipea un límite de crédito a mano.
    expect(parsearImporte("1.500.000")).toBe(1500000);
    expect(parsearImporte("12.345.678")).toBe(12345678);
  });

  it("acepta un entero pelado", () => {
    expect(parsearImporte("528300")).toBe(528300);
  });

  it("ignora los espacios", () => {
    expect(parsearImporte(" 1.500,25 ")).toBe(1500.25);
  });

  it("devuelve NaN con texto vacío o basura, nunca cero", () => {
    // Cero sería peor: un importe inválido tomado como cero se guarda sin
    // avisar, y el cobro queda registrado en cero.
    expect(parsearImporte("")).toBeNaN();
    expect(parsearImporte("   ")).toBeNaN();
    expect(parsearImporte("mil pesos")).toBeNaN();
  });
});
