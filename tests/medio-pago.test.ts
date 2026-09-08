import { describe, expect, it } from "vitest";
import {
  descuentoPorMedioDePago,
  medioPermitido,
  mediosHabilitados,
  montoDelDescuentoDePago,
  type EscalaDePago,
} from "@/lib/precios/medio-pago";

/** Las escalas del brief: 10 % de base, 15 % desde medio millón. */
const ESCALAS: EscalaDePago[] = [
  { medio: "transferencia", desdeMonto: 0, porcentaje: 10, etiqueta: "10% por transferencia" },
  { medio: "transferencia", desdeMonto: 500000, porcentaje: 15, etiqueta: "15% por volumen" },
  { medio: "efectivo", desdeMonto: 0, porcentaje: 10, etiqueta: "10% en efectivo" },
];

describe("descuentoPorMedioDePago", () => {
  it("aplica el escalón base", () => {
    expect(descuentoPorMedioDePago(ESCALAS, "transferencia", 100000)?.porcentaje).toBe(10);
  });

  it("gana el escalón más alto que el total alcanza", () => {
    expect(descuentoPorMedioDePago(ESCALAS, "transferencia", 600000)?.porcentaje).toBe(15);
  });

  it("justo en el piso del escalón, ya entra", () => {
    expect(descuentoPorMedioDePago(ESCALAS, "transferencia", 500000)?.porcentaje).toBe(15);
  });

  it("un peso menos se queda en el escalón anterior", () => {
    expect(descuentoPorMedioDePago(ESCALAS, "transferencia", 499999)?.porcentaje).toBe(10);
  });

  it("no descuenta nada en un medio sin escala cargada", () => {
    expect(descuentoPorMedioDePago(ESCALAS, "mercado_pago", 600000)).toBeNull();
    expect(descuentoPorMedioDePago(ESCALAS, "cuenta_corriente", 600000)).toBeNull();
  });

  it("no descuenta con la lista vacía", () => {
    expect(descuentoPorMedioDePago([], "transferencia", 600000)).toBeNull();
  });

  it("acota un porcentaje cargado mal", () => {
    // Alguien que tipea el monto en el campo del porcentaje no puede dejar la
    // venta en cero.
    const roto = [{ medio: "efectivo", desdeMonto: 0, porcentaje: 500000, etiqueta: "" }];
    expect(descuentoPorMedioDePago(roto, "efectivo", 1000)?.porcentaje).toBe(90);
  });
});

describe("montoDelDescuentoDePago", () => {
  it("calcula el 10 % sobre el total", () => {
    expect(montoDelDescuentoDePago(48500, 10)).toBe(4850);
  });

  it("redondea a centavos y no arrastra decimales", () => {
    expect(montoDelDescuentoDePago(333.33, 15)).toBe(50);
  });

  it("no descuenta sobre un total en cero", () => {
    expect(montoDelDescuentoDePago(0, 10)).toBe(0);
  });
});

/**
 * El precio mayorista es de contado. De la clienta: transferencia o débito, y
 * nunca crédito en cuotas. Quien paga de otra forma va a precio de catálogo.
 */
describe("mediosHabilitados", () => {
  const MEDIOS = [
    { valor: "mercado_pago" },
    { valor: "transferencia" },
    { valor: "debito" },
    { valor: "efectivo" },
  ] as const;

  it("no toca nada cuando el precio es el de catálogo", () => {
    expect(mediosHabilitados(MEDIOS, false)).toHaveLength(4);
  });

  it("saca la tarjeta en cuotas cuando el precio es mayorista", () => {
    const valores = mediosHabilitados(MEDIOS, true).map((m) => m.valor);

    expect(valores).toEqual(["transferencia", "debito", "efectivo"]);
    expect(valores).not.toContain("mercado_pago");
  });
});

describe("medioPermitido", () => {
  it("deja pasar cualquier medio a precio de catálogo", () => {
    expect(medioPermitido("mercado_pago", false)).toBe(true);
    expect(medioPermitido("credito", false)).toBe(true);
  });

  it("con precio mayorista solo admite los de contado", () => {
    expect(medioPermitido("transferencia", true)).toBe(true);
    expect(medioPermitido("debito", true)).toBe(true);
    expect(medioPermitido("efectivo", true)).toBe(true);
    expect(medioPermitido("cuenta_corriente", true)).toBe(true);
  });

  it("con precio mayorista rechaza el crédito y Mercado Pago", () => {
    expect(medioPermitido("credito", true)).toBe(false);
    expect(medioPermitido("mercado_pago", true)).toBe(false);
  });
});
