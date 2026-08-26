import { describe, expect, it } from "vitest";
import {
  descuentoPorVolumen,
  precioConDescuento,
  type EscalaDeVolumen,
} from "@/lib/precios/volumen";

function escala(
  parcial: Partial<EscalaDeVolumen> & { desdeCantidad: number; porcentaje: number },
): EscalaDeVolumen {
  return {
    id: Math.random().toString(36),
    variantId: null,
    categoryId: null,
    ...parcial,
  };
}

describe("descuentoPorVolumen", () => {
  const contexto = { variantId: "v1", categoryId: "c1", cantidad: 20 };

  it("sin escalas no descuenta", () => {
    expect(descuentoPorVolumen([], contexto)).toBe(0);
  });

  it("no aplica por debajo del mínimo", () => {
    const escalas = [escala({ desdeCantidad: 50, porcentaje: 15 })];
    expect(descuentoPorVolumen(escalas, contexto)).toBe(0);
  });

  it("aplica desde el mínimo exacto", () => {
    const escalas = [escala({ desdeCantidad: 20, porcentaje: 10 })];
    expect(descuentoPorVolumen(escalas, contexto)).toBe(10);
  });

  it("entre tramos del mismo nivel gana el de mayor cantidad", () => {
    // Son los peldaños de una misma escalera: a 20 unidades corresponde el de 20.
    const escalas = [
      escala({ desdeCantidad: 10, porcentaje: 5 }),
      escala({ desdeCantidad: 20, porcentaje: 12 }),
      escala({ desdeCantidad: 50, porcentaje: 20 }),
    ];
    expect(descuentoPorVolumen(escalas, contexto)).toBe(12);
  });

  it("la escala de una variante le gana a la de su categoría", () => {
    // Aunque el porcentaje sea menor: una excepción cargada a mano para un
    // producto tiene que poder ser a la baja.
    const escalas = [
      escala({ categoryId: "c1", desdeCantidad: 10, porcentaje: 20 }),
      escala({ variantId: "v1", desdeCantidad: 10, porcentaje: 5 }),
    ];
    expect(descuentoPorVolumen(escalas, contexto)).toBe(5);
  });

  it("la de categoría le gana a la general", () => {
    const escalas = [
      escala({ desdeCantidad: 10, porcentaje: 18 }),
      escala({ categoryId: "c1", desdeCantidad: 10, porcentaje: 7 }),
    ];
    expect(descuentoPorVolumen(escalas, contexto)).toBe(7);
  });

  it("ignora escalas de otra variante u otra categoría", () => {
    const escalas = [
      escala({ variantId: "otra", desdeCantidad: 1, porcentaje: 30 }),
      escala({ categoryId: "otra", desdeCantidad: 1, porcentaje: 25 }),
    ];
    expect(descuentoPorVolumen(escalas, contexto)).toBe(0);
  });

  it("ignora escalas en cero", () => {
    const escalas = [escala({ desdeCantidad: 1, porcentaje: 0 })];
    expect(descuentoPorVolumen(escalas, contexto)).toBe(0);
  });

  it("funciona con líneas sin variante, como las tipeadas a mano", () => {
    const escalas = [escala({ desdeCantidad: 5, porcentaje: 10 })];
    expect(
      descuentoPorVolumen(escalas, {
        variantId: null,
        categoryId: null,
        cantidad: 8,
      }),
    ).toBe(10);
  });
});

describe("precioConDescuento", () => {
  it("aplica el porcentaje y redondea a dos decimales", () => {
    expect(precioConDescuento(1000, 10)).toBe(900);
    expect(precioConDescuento(19636.33, 12)).toBe(17279.97);
  });

  it("sin descuento devuelve el mismo precio", () => {
    expect(precioConDescuento(1000, 0)).toBe(1000);
  });

  it("acota un descuento absurdo en vez de regalar la mercadería", () => {
    // Una escala mal tipeada no puede dejar el producto en cero.
    expect(precioConDescuento(1000, 100)).toBe(100);
    expect(precioConDescuento(1000, 500)).toBe(100);
  });
});
