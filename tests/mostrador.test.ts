import { describe, expect, it } from "vitest";
import {
  aCentavos,
  revisarVenta,
  totalDeLaVenta,
  vuelto,
  type LineaDeVenta,
} from "@/lib/mostrador/importes";

const linea = (p: Partial<LineaDeVenta> = {}): LineaDeVenta => ({
  variantId: "v1",
  descripcion: "Fenólico 18mm",
  unidad: "unidad",
  cantidad: 1,
  precioUnitario: 1000,
  ...p,
});

/**
 * Lo que se prueba acá es la plata del mostrador: el total que se le canta al
 * cliente, el vuelto que se le da en la mano y las reglas que impiden cobrar
 * algo que no se puede cobrar. Es lo que no tiene forma de revisarse después:
 * un vuelto mal calculado se va con la persona.
 */
describe("total de la venta", () => {
  it("suma cantidad por precio", () => {
    expect(totalDeLaVenta([linea({ cantidad: 2, precioUnitario: 48900 })])).toBe(97800);
  });

  it("redondea cada línea antes de sumar, no al final", () => {
    // Tres líneas de 0,105 dan 0,315 si se redondea al final y 0,33 si se
    // redondea renglón por renglón. El comprobante muestra los renglones, así
    // que el total tiene que ser el de los renglones.
    const lineas = [
      linea({ cantidad: 3, precioUnitario: 0.035 }),
      linea({ cantidad: 3, precioUnitario: 0.035 }),
      linea({ cantidad: 3, precioUnitario: 0.035 }),
    ];
    expect(totalDeLaVenta(lineas)).toBe(0.33);
  });

  it("maneja cantidades con decimales, que en madera son la norma", () => {
    // 2,5 metros de moldura a $3.740 el metro.
    expect(totalDeLaVenta([linea({ cantidad: 2.5, precioUnitario: 3740 })])).toBe(9350);
  });

  it("no arrastra el error del punto flotante", () => {
    expect(aCentavos(0.1 + 0.2)).toBe(0.3);
    expect(totalDeLaVenta([linea({ cantidad: 3, precioUnitario: 0.1 })])).toBe(0.3);
  });
});

describe("qué se puede cobrar y qué no", () => {
  it("acepta una venta común", () => {
    expect(revisarVenta([linea()], "efectivo", null)).toBeNull();
  });

  it("rechaza la venta vacía", () => {
    expect(revisarVenta([], "efectivo", null)).toMatch(/ningún ítem/);
  });

  it("rechaza cantidad cero o negativa", () => {
    expect(revisarVenta([linea({ cantidad: 0 })], "efectivo", null)).toMatch(/mayor a cero/);
    expect(revisarVenta([linea({ cantidad: -2 })], "efectivo", null)).toMatch(/mayor a cero/);
  });

  it("rechaza un precio negativo, que sería regalar plata", () => {
    expect(revisarVenta([linea({ precioUnitario: -500 })], "efectivo", null)).toMatch(
      /no puede ser negativo/,
    );
  });

  it("deja pasar una línea en cero pero no una venta en cero", () => {
    // Una línea a $0 es legítima: una pieza de regalo dentro de una venta.
    expect(revisarVenta([linea(), linea({ precioUnitario: 0 })], "efectivo", null)).toBeNull();
    // Toda la venta en cero, no: eso es un error de carga.
    expect(revisarVenta([linea({ precioUnitario: 0 })], "efectivo", null)).toMatch(
      /mayor a cero/,
    );
  });

  it("no deja fiar sin saber a quién", () => {
    expect(revisarVenta([linea()], "cuenta_corriente", null)).toMatch(/elegir el cliente/);
    expect(revisarVenta([linea()], "cuenta_corriente", "cli-1")).toBeNull();
  });

  it("rechaza números que no son números", () => {
    expect(revisarVenta([linea({ cantidad: NaN })], "efectivo", null)).toMatch(/mayor a cero/);
    expect(revisarVenta([linea({ precioUnitario: Infinity })], "efectivo", null)).toMatch(
      /no puede ser negativo/,
    );
  });
});

describe("vuelto", () => {
  it("devuelve la diferencia", () => {
    expect(vuelto(110200, 150000)).toBe(39800);
  });

  it("es cero cuando pagan justo", () => {
    expect(vuelto(110200, 110200)).toBe(0);
  });

  it("es nulo cuando no alcanza, y no un negativo", () => {
    // Un vuelto negativo en pantalla se lee como si hubiera que devolver plata.
    expect(vuelto(110200, 100000)).toBeNull();
  });

  it("no arrastra centavos fantasma", () => {
    expect(vuelto(0.3, 1)).toBe(0.7);
  });
});
