import { describe, expect, it } from "vitest";
import {
  aCentavos,
  montoDelDescuento,
  aplicarDescuento,
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

describe("descuento", () => {
  it("calcula el porcentaje", () => {
    expect(montoDelDescuento(100000, "porcentaje", 10)).toBe(10000);
  });

  it("toma el monto tal cual", () => {
    expect(montoDelDescuento(100000, "monto", 7500)).toBe(7500);
  });

  it("no descuenta más que el total", () => {
    // Tipear 200000 de descuento sobre una venta de 100000 no es un descuento,
    // es un error; un total negativo sería plata que la maderera devuelve.
    expect(montoDelDescuento(100000, "monto", 200000)).toBe(100000);
    expect(montoDelDescuento(100000, "porcentaje", 150)).toBe(100000);
  });

  it("ignora valores que no descuentan nada", () => {
    expect(montoDelDescuento(100000, "monto", 0)).toBe(0);
    expect(montoDelDescuento(100000, "monto", -500)).toBe(0);
    expect(montoDelDescuento(100000, "porcentaje", NaN)).toBe(0);
  });
});

describe("cómo se reparte el descuento entre las líneas", () => {
  it("baja cada precio en la misma proporción", () => {
    const lineas = [
      linea({ cantidad: 1, precioUnitario: 100000 }),
      linea({ variantId: "v2", cantidad: 1, precioUnitario: 100000 }),
    ];
    const r = aplicarDescuento(lineas, 20000);
    expect(r.lineas[0].precioUnitario).toBe(90000);
    expect(r.lineas[1].precioUnitario).toBe(90000);
    expect(r.descuento).toBe(20000);
  });

  it("lo que se cobra es siempre la suma de los renglones", () => {
    // Tres líneas raras y un descuento que no divide redondo. Acá es donde un
    // prorrateo que persigue un total exacto termina mostrando un total que no
    // coincide con sus propios renglones.
    const lineas = [
      linea({ cantidad: 3, precioUnitario: 1333.33 }),
      linea({ variantId: "v2", cantidad: 7, precioUnitario: 977.11 }),
      linea({ variantId: "v3", cantidad: 1, precioUnitario: 45.05 }),
    ];
    const total = totalDeLaVenta(lineas);
    const pedido = montoDelDescuento(total, "porcentaje", 13);
    const r = aplicarDescuento(lineas, pedido);

    // La identidad que tiene que valer siempre: subtotal − descuento = total.
    expect(aCentavos(total - r.descuento)).toBe(totalDeLaVenta(r.lineas));
    // Y el descuento real no se aleja del pedido más que unos centavos.
    expect(Math.abs(r.descuento - pedido)).toBeLessThan(0.1);
  });

  it("no toca nada si no hay descuento", () => {
    const lineas = [linea()];
    expect(aplicarDescuento(lineas, 0)).toEqual({ lineas, descuento: 0 });
  });

  it("un descuento del total deja todo en cero", () => {
    const lineas = [linea({ cantidad: 2, precioUnitario: 500 })];
    const r = aplicarDescuento(lineas, 1000);
    expect(totalDeLaVenta(r.lineas)).toBe(0);
    expect(r.descuento).toBe(1000);
  });
});
