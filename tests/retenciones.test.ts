import { describe, expect, it } from "vitest";
import {
  calcularRetencion,
  type RegimenDeRetencion,
} from "@/lib/retenciones/calculo";

/**
 * El cálculo de retenciones.
 *
 * Es la parte más normativa de todo el sistema y la que más se equivoca a mano.
 * El error clásico no es la multiplicación: es **mirar cada pago suelto en vez
 * del acumulado del mes**. Con el mínimo no imponible en $224.000, cuatro pagos
 * de $80.000 no retienen nada mirados de a uno y sí retienen mirados juntos, que
 * es como los mira ARCA.
 */

const ganancias: RegimenDeRetencion = {
  codigo: "78",
  nombre: "Ganancias · bienes",
  impuesto: "ganancias",
  alicuota: 2,
  alicuotaNoInscripto: 28,
  minimoNoImponible: 224_000,
  minimoRetencion: 21_000,
};

describe("calcularRetencion", () => {
  it("no retiene por debajo del mínimo no imponible", () => {
    const r = calcularRetencion({
      base: 100_000,
      acumuladoMes: 0,
      retenidoMes: 0,
      regimen: ganancias,
      inscripto: true,
    });

    expect(r.retencion).toBe(0);
    expect(r.motivo).toContain("mínimo no imponible");
  });

  it("mira el acumulado del mes y no el pago suelto", () => {
    /*
     * **Es el error que este archivo existe para evitar.** Cuatro pagos de
     * $80.000 no llegan al mínimo mirados de a uno; juntos suman $320.000 y
     * sí. Calcular pago por pago deja de retener todo el año.
     */
    const r = calcularRetencion({
      base: 80_000,
      acumuladoMes: 240_000, // tres pagos anteriores del mes
      retenidoMes: 0,
      regimen: ganancias,
      inscripto: true,
    });

    // (320.000 − 224.000) × 2 % = 1.920, por debajo del mínimo de retención.
    expect(r.imponible).toBe(96_000);
    expect(r.retencion).toBe(0);
    expect(r.motivo).toContain("mínimo de retención");
  });

  it("descuenta lo ya retenido en el mes", () => {
    /*
     * La retención se calcula sobre el acumulado y después se resta lo que ya
     * se le retuvo. Sin esa resta, el segundo pago del mes retiene otra vez
     * sobre la misma base y el proveedor cobra de menos.
     */
    const r = calcularRetencion({
      base: 2_000_000,
      acumuladoMes: 3_000_000,
      retenidoMes: 55_520, // (3.000.000 − 224.000) × 2 %
      regimen: ganancias,
      inscripto: true,
    });

    // Acumulado 5.000.000 − 224.000 = 4.776.000 × 2 % = 95.520.
    // Ya retenido 55.520 → toca retener 40.000.
    expect(r.retencion).toBeCloseTo(40_000, 2);
  });

  it("nunca devuelve una retención negativa", () => {
    /*
     * Pasa cuando una nota de crédito baja el acumulado del mes por debajo de
     * lo ya retenido. Devolver un negativo haría que el sistema le "pague" al
     * proveedor la retención, que no es algo que se pueda hacer: la corrección
     * la hace el proveedor con su declaración.
     */
    const r = calcularRetencion({
      base: 0,
      acumuladoMes: 300_000,
      retenidoMes: 200_000,
      regimen: ganancias,
      inscripto: true,
    });

    expect(r.retencion).toBe(0);
  });

  it("al no inscripto se le aplica la alícuota agravada y sin mínimo", () => {
    /*
     * Un proveedor no inscripto en el régimen no tiene mínimo no imponible: se
     * le retiene sobre el total y a la alícuota mayor. Aplicarle el mínimo del
     * inscripto es de los errores que ARCA reclama con intereses.
     */
    const r = calcularRetencion({
      base: 100_000,
      acumuladoMes: 0,
      retenidoMes: 0,
      regimen: ganancias,
      inscripto: false,
    });

    expect(r.alicuota).toBe(28);
    expect(r.imponible).toBe(100_000);
    expect(r.retencion).toBe(28_000);
  });

  it("retiene cuando supera los dos mínimos", () => {
    const r = calcularRetencion({
      base: 3_000_000,
      acumuladoMes: 0,
      retenidoMes: 0,
      regimen: ganancias,
      inscripto: true,
    });

    // (3.000.000 − 224.000) × 2 % = 55.520, por encima del mínimo de 21.000.
    expect(r.imponible).toBe(2_776_000);
    expect(r.retencion).toBeCloseTo(55_520, 2);
    expect(r.motivo).toBeNull();
  });

  it("un régimen sin mínimos retiene desde el primer peso", () => {
    // El de IVA no tiene mínimo no imponible: se retiene sobre el IVA de la
    // factura desde el arranque.
    const iva: RegimenDeRetencion = {
      codigo: "499",
      nombre: "IVA · bienes",
      impuesto: "iva",
      alicuota: 8.68,
      alicuotaNoInscripto: 10.5,
      minimoNoImponible: 0,
      minimoRetencion: 0,
    };

    const r = calcularRetencion({
      base: 21_000,
      acumuladoMes: 0,
      retenidoMes: 0,
      regimen: iva,
      inscripto: true,
    });

    expect(r.retencion).toBeCloseTo(1_822.8, 2);
  });

  it("redondea a centavos y no arrastra fracciones", () => {
    const r = calcularRetencion({
      base: 1_000_003,
      acumuladoMes: 0,
      retenidoMes: 0,
      regimen: { ...ganancias, minimoNoImponible: 0, minimoRetencion: 0, alicuota: 1.23 },
      inscripto: true,
    });

    expect(r.retencion).toBe(12_300.04);
  });

  it("una base negativa no genera retención", () => {
    const r = calcularRetencion({
      base: -50_000,
      acumuladoMes: 0,
      retenidoMes: 0,
      regimen: ganancias,
      inscripto: true,
    });

    expect(r.retencion).toBe(0);
    expect(r.imponible).toBe(0);
  });
});
