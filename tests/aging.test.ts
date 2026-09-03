import { describe, expect, it } from "vitest";
import { calcularAging } from "@/lib/cuenta-corriente/aging";

const HOY = new Date("2026-09-03T12:00:00Z");

/** Un movimiento a N días de hoy. Positivo debe, negativo paga. */
function hace(dias: number, monto: number) {
  return { monto, fecha: new Date(HOY.getTime() - dias * 24 * 60 * 60 * 1000) };
}

const tramo = (a: ReturnType<typeof calcularAging>, etiqueta: string) =>
  a.tramos.find((t) => t.etiqueta === etiqueta)!.monto;

/**
 * La antigüedad de la deuda decide si se sigue vendiendo a cuenta o se levanta
 * el teléfono, así que equivocarse acá cuesta plata de las dos maneras: cortarle
 * el crédito a quien está al día, o seguir fiándole a quien no paga hace medio
 * año.
 *
 * El punto delicado es la imputación: la cuenta corriente no ata cada pago a un
 * comprobante, así que el pago cancela **lo más viejo primero**. Estos casos
 * fijan esa regla.
 */
describe("antigüedad de la deuda", () => {
  it("sin movimientos no debe nada", () => {
    const a = calcularAging([], HOY);
    expect(a.total).toBe(0);
    expect(a.diasDeLaMasVieja).toBeNull();
  });

  it("clasifica cada deuda en su tramo", () => {
    const a = calcularAging(
      [hace(5, 10_000), hace(45, 20_000), hace(75, 30_000), hace(200, 40_000)],
      HOY,
    );

    expect(tramo(a, "Al día")).toBe(10_000);
    expect(tramo(a, "31 a 60 días")).toBe(20_000);
    expect(tramo(a, "61 a 90 días")).toBe(30_000);
    expect(tramo(a, "Más de 90 días")).toBe(40_000);
    expect(a.total).toBe(100_000);
  });

  it("el pago cancela lo más viejo primero", () => {
    // Debe 10.000 de hace 200 días y 10.000 de hace 5. Paga 10.000.
    const a = calcularAging([hace(200, 10_000), hace(5, 10_000), hace(1, -10_000)], HOY);

    // Lo que queda es lo nuevo, no lo viejo.
    expect(tramo(a, "Más de 90 días")).toBe(0);
    expect(tramo(a, "Al día")).toBe(10_000);
    expect(a.total).toBe(10_000);
    expect(a.diasDeLaMasVieja).toBe(5);
  });

  it("un pago parcial deja el resto en el tramo de la deuda vieja", () => {
    const a = calcularAging([hace(120, 100_000), hace(1, -30_000)], HOY);

    expect(tramo(a, "Más de 90 días")).toBe(70_000);
    expect(a.total).toBe(70_000);
  });

  it("un pago que cubre todo deja la cuenta en cero, no en negativo", () => {
    const a = calcularAging([hace(30, 50_000), hace(1, -50_000)], HOY);

    expect(a.total).toBe(0);
    expect(a.aFavor).toBe(0);
    expect(a.diasDeLaMasVieja).toBeNull();
  });

  it("pagar de más queda como saldo a favor y no como deuda negativa", () => {
    const a = calcularAging([hace(30, 50_000), hace(1, -80_000)], HOY);

    expect(a.total).toBe(0);
    expect(a.aFavor).toBe(30_000);
  });

  it("el saldo a favor se consume con la compra siguiente", () => {
    const a = calcularAging(
      [hace(60, 50_000), hace(50, -80_000), hace(2, 20_000)],
      HOY,
    );

    // Quedaban 30.000 a favor y compra por 20.000: no debe nada y le sobran 10.000.
    expect(a.total).toBe(0);
    expect(a.aFavor).toBe(10_000);
  });

  it("el orden en que llegan los movimientos no cambia el resultado", () => {
    const movimientos = [hace(200, 10_000), hace(5, 10_000), hace(1, -10_000)];
    const derecho = calcularAging(movimientos, HOY);
    const alReves = calcularAging([...movimientos].reverse(), HOY);

    expect(alReves.total).toBe(derecho.total);
    expect(tramo(alReves, "Al día")).toBe(tramo(derecho, "Al día"));
  });

  it("los bordes de los tramos caen donde dicen", () => {
    const a = calcularAging([hace(30, 1_000), hace(31, 2_000), hace(90, 3_000), hace(91, 4_000)], HOY);

    expect(tramo(a, "Al día")).toBe(1_000);
    expect(tramo(a, "31 a 60 días")).toBe(2_000);
    expect(tramo(a, "61 a 90 días")).toBe(3_000);
    expect(tramo(a, "Más de 90 días")).toBe(4_000);
  });

  it("no deja restos de centavos por redondeo", () => {
    const a = calcularAging([hace(10, 100.05), hace(5, -100.049)], HOY);
    expect(a.total).toBe(0);
  });
});
