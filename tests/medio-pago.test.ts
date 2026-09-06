import { describe, expect, it } from "vitest";
import {
  descuentoPorMedioDePago,
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
