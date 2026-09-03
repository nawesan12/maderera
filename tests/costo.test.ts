import { describe, expect, it } from "vitest";
import {
  mezclarCosto,
  prorratearGastos,
  margenDeLinea,
  type EstadoDeCosto,
} from "@/lib/compras/costo";

/**
 * El costo promedio ponderado.
 *
 * Es plata: de este número sale el margen, y del margen salen las decisiones de
 * precio. Un error del 3 % acá no se nota en ninguna pantalla y aparece seis
 * meses después como "estamos vendiendo a pérdida y no sabemos desde cuándo".
 */

const estado = (cantidadBase: number, costoPromedio: number): EstadoDeCosto => ({
  cantidadBase,
  costoPromedio,
});

describe("mezclarCosto", () => {
  it("con stock en cero, el costo es el de lo que entra", () => {
    const r = mezclarCosto(estado(0, 0), { cantidad: 10, costoUnitario: 1500 });
    expect(r).toEqual({ cantidadBase: 10, costoPromedio: 1500 });
  });

  it("mezcla pesando por cantidad, no por precio", () => {
    // 10 a $1000 y 30 a $2000 → 40 unidades a $1750, no a $1500.
    const r = mezclarCosto(estado(10, 1000), {
      cantidad: 30,
      costoUnitario: 2000,
    });
    expect(r.cantidadBase).toBe(40);
    expect(r.costoPromedio).toBe(1750);
  });

  it("una entrada chica mueve poco el promedio", () => {
    const r = mezclarCosto(estado(100, 1000), {
      cantidad: 1,
      costoUnitario: 5000,
    });
    // El precio de lo que entra es cinco veces mayor, pero es una unidad
    // contra cien: mueve $39,60, no la mitad.
    expect(r.costoPromedio).toBe(1039.604);
  });

  it("guarda cuatro decimales y no dos", () => {
    /*
     * Es la razón por la que el costo lleva cuatro decimales: redondear a dos
     * en cada una de doscientas recepciones deriva varios pesos por unidad, y
     * la deriva es siempre para el mismo lado.
     */
    const r = mezclarCosto(estado(3, 10), { cantidad: 1, costoUnitario: 10.02 });
    expect(r.costoPromedio).toBe(10.005);
  });

  it("con stock negativo trata el stock como cero", () => {
    /*
     * Promediar contra −3 da un costo disparatado o negativo. "No había nada
     * valorizado, ahora vale lo que costó" es lo único que se puede explicar
     * en el mostrador.
     */
    const r = mezclarCosto(estado(-3, 1000), {
      cantidad: 10,
      costoUnitario: 2000,
    });
    expect(r).toEqual({ cantidadBase: 10, costoPromedio: 2000 });
  });

  it("una entrada de cero no toca nada", () => {
    const previo = estado(10, 1000);
    expect(mezclarCosto(previo, { cantidad: 0, costoUnitario: 9999 })).toEqual(
      previo,
    );
  });

  it("una entrada con costo cero sí baja el promedio", () => {
    // Una bonificación es mercadería que entró y no costó nada. Ignorarla
    // dejaría el promedio más alto de lo que realmente se pagó.
    const r = mezclarCosto(estado(10, 1000), {
      cantidad: 10,
      costoUnitario: 0,
    });
    expect(r.costoPromedio).toBe(500);
  });

  it("rechaza cantidades y costos que no son números", () => {
    const previo = estado(10, 1000);
    expect(
      mezclarCosto(previo, { cantidad: Number.NaN, costoUnitario: 100 }),
    ).toEqual(previo);
    expect(
      mezclarCosto(previo, { cantidad: 5, costoUnitario: Number.NaN }),
    ).toEqual(previo);
  });

  it("no acepta costos negativos", () => {
    const previo = estado(10, 1000);
    expect(
      mezclarCosto(previo, { cantidad: 5, costoUnitario: -100 }),
    ).toEqual(previo);
  });
});

describe("prorratearGastos", () => {
  it("reparte el flete en proporción al valor de cada línea", () => {
    const lineas = [
      { cantidad: 10, costoUnitario: 100 }, // 1000
      { cantidad: 10, costoUnitario: 300 }, // 3000
    ];
    const r = prorratearGastos(lineas, 400);

    // 400 sobre 4000 es 10 %: cada línea sube un 10 % de su valor.
    expect(r[0].costoConGastos).toBeCloseTo(110, 4);
    expect(r[1].costoConGastos).toBeCloseTo(330, 4);
  });

  it("sin gastos devuelve el costo tal cual", () => {
    const r = prorratearGastos([{ cantidad: 2, costoUnitario: 50 }], 0);
    expect(r[0].costoConGastos).toBe(50);
  });

  it("reparte el resto en la línea más grande y no lo pierde", () => {
    /*
     * Tres líneas iguales y un gasto de $10 no se dividen en tercios exactos.
     * El centavo que sobra tiene que quedar en algún lado: si se pierde, el
     * total de la recepción deja de coincidir con la factura del proveedor y
     * alguien va a pasar una tarde buscando un centavo.
     */
    const lineas = [
      { cantidad: 1, costoUnitario: 100 },
      { cantidad: 1, costoUnitario: 100 },
      { cantidad: 1, costoUnitario: 100 },
    ];
    const r = prorratearGastos(lineas, 10);

    const repartido = r.reduce(
      (t, l, i) => t + (l.costoConGastos - lineas[i].costoUnitario) * lineas[i].cantidad,
      0,
    );
    expect(repartido).toBeCloseTo(10, 6);
  });

  it("con líneas de valor cero reparte por cantidad", () => {
    // Una recepción íntegramente bonificada con flete: el flete costó igual.
    const r = prorratearGastos(
      [
        { cantidad: 1, costoUnitario: 0 },
        { cantidad: 3, costoUnitario: 0 },
      ],
      40,
    );
    expect(r[0].costoConGastos).toBeCloseTo(10, 4);
    expect(r[1].costoConGastos).toBeCloseTo(10, 4);
  });
});

describe("margenDeLinea", () => {
  it("compara neto contra neto y no contra el precio final", () => {
    /*
     * **Es el error que este módulo existe para evitar.** El subtotal de la
     * venta es final —lleva el IVA adentro— y el costo es neto. Compararlos
     * directo infla el margen un 21 % sistemático.
     */
    const r = margenDeLinea({
      subtotal: 1210, // $1000 netos más 21 %
      cantidad: 1,
      alicuotaIva: 21,
      costoUnitario: 800,
    });

    expect(r.netoVenta).toBeCloseTo(1000, 4);
    expect(r.costoTotal).toBe(800);
    expect(r.margen).toBeCloseTo(200, 4);
    expect(r.margenPorcentual).toBeCloseTo(20, 4);
  });

  it("usa la alícuota de la línea y no una constante", () => {
    // La maderera vende algunos ítems al 10,5 %. Con 21 fijo, el margen de
    // esos sale casi diez puntos por debajo del real.
    const r = margenDeLinea({
      subtotal: 1105,
      cantidad: 1,
      alicuotaIva: 10.5,
      costoUnitario: 800,
    });
    expect(r.netoVenta).toBeCloseTo(1000, 4);
    expect(r.margen).toBeCloseTo(200, 4);
  });

  it("sin costo no inventa un margen", () => {
    /*
     * Las ventas anteriores al módulo no tienen costo. Devolver margen cero
     * las mezclaría con las que efectivamente se vendieron sin ganancia, y
     * ese promedio es exactamente el número sobre el que no se puede decidir
     * nada.
     */
    const r = margenDeLinea({
      subtotal: 1210,
      cantidad: 1,
      alicuotaIva: 21,
      costoUnitario: null,
    });
    expect(r.costoTotal).toBeNull();
    expect(r.margen).toBeNull();
    expect(r.margenPorcentual).toBeNull();
  });

  it("un margen negativo se informa como negativo", () => {
    // Vender bajo el costo pasa, y taparlo es lo peor que se puede hacer.
    const r = margenDeLinea({
      subtotal: 1210,
      cantidad: 1,
      alicuotaIva: 21,
      costoUnitario: 1200,
    });
    expect(r.margen).toBeCloseTo(-200, 4);
    expect(r.margenPorcentual).toBeCloseTo(-20, 4);
  });

  it("con venta en cero no divide por cero", () => {
    const r = margenDeLinea({
      subtotal: 0,
      cantidad: 1,
      alicuotaIva: 21,
      costoUnitario: 500,
    });
    expect(r.margen).toBeCloseTo(-500, 4);
    expect(r.margenPorcentual).toBeNull();
  });
});
