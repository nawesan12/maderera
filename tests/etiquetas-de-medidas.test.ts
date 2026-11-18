import { describe, expect, it } from "vitest";
import {
  escribirPedidoDeEtiquetas,
  formatoDeEtiqueta,
  leerPedidoDeEtiquetas,
  repartirEnHojas,
  TOPE_DE_ETIQUETAS,
  TOPE_DE_MEDIDAS,
  TOPE_POR_MEDIDA,
  tramos,
} from "@/lib/etiquetas-de-medidas";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

/**
 * El pedido de etiquetas viaja en la URL: lo escribe la pantalla que elige y
 * lo lee la hoja que imprime. Lo que no se entiende se descarta en vez de
 * imprimir una resma por un cero de más.
 */
describe("leerPedidoDeEtiquetas", () => {
  it("lee ids con y sin cantidad, y suma las repetidas", () => {
    expect(leerPedidoDeEtiquetas(`${A}*3,${B},${A}*2`)).toEqual([
      { id: A, cantidad: 5 },
      { id: B, cantidad: 1 },
    ]);
  });

  it("descarta lo que no es un id o una cantidad válida", () => {
    expect(leerPedidoDeEtiquetas(`x*3,${A}*0,${A}*-2,${A}*abc,,${B}*2.7`)).toEqual([{ id: B, cantidad: 2 }]);
    expect(leerPedidoDeEtiquetas(undefined)).toEqual([]);
  });

  it("acepta el parámetro repetido", () => {
    expect(leerPedidoDeEtiquetas([A, `${B}*4`])).toEqual([
      { id: A, cantidad: 1 },
      { id: B, cantidad: 4 },
    ]);
  });

  it("no pasa de los topes", () => {
    expect(leerPedidoDeEtiquetas(`${A}*99999`)).toEqual([{ id: A, cantidad: TOPE_POR_MEDIDA }]);
    const muchas = Array.from({ length: 8 }, (_, i) => `${String(i).repeat(8)}-1111-4111-8111-111111111111*200`).join(",");
    const total = leerPedidoDeEtiquetas(muchas).reduce((s, p) => s + p.cantidad, 0);
    expect(total).toBe(TOPE_DE_ETIQUETAS);
  });

  it("no pide a Go más medidas de las que acepta", () => {
    const ids = Array.from(
      { length: TOPE_DE_MEDIDAS + 50 },
      (_, i) => `${i.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`,
    ).join(",");
    expect(leerPedidoDeEtiquetas(ids)).toHaveLength(TOPE_DE_MEDIDAS);
    expect(TOPE_DE_MEDIDAS).toBe(300);
  });

  it("ida y vuelta con escribirPedidoDeEtiquetas", () => {
    const pedido = [
      { id: A, cantidad: 1 },
      { id: B, cantidad: 7 },
    ];
    expect(escribirPedidoDeEtiquetas(pedido)).toBe(`${A},${B}*7`);
    expect(leerPedidoDeEtiquetas(escribirPedidoDeEtiquetas(pedido))).toEqual(pedido);
  });
});

describe("repartirEnHojas", () => {
  it("una etiqueta por unidad, en el orden pedido, en hojas del tamaño del formato", () => {
    const datos = [{ variantId: B }, { variantId: A }];
    const hojas = repartirEnHojas(datos, [
      { id: A, cantidad: 2 },
      { id: B, cantidad: 3 },
    ], 2);
    expect(hojas.map((h) => h.map((d) => d.variantId))).toEqual([[A, A], [B, B], [B]]);
  });

  it("saltea lo pedido que Go no devolvió", () => {
    expect(repartirEnHojas([{ variantId: A }], [{ id: B, cantidad: 3 }], 21)).toEqual([]);
  });
});

describe("formatoDeEtiqueta y tramos", () => {
  it("el A4 es el formato por omisión", () => {
    expect(formatoDeEtiqueta("rollo")).toBe("rollo");
    expect(formatoDeEtiqueta("cualquiera")).toBe("a4");
    expect(formatoDeEtiqueta(undefined)).toBe("a4");
  });

  it("junta los módulos seguidos en barras", () => {
    expect(tramos("1101000111")).toEqual([
      { x: 0, ancho: 2 },
      { x: 3, ancho: 1 },
      { x: 7, ancho: 3 },
    ]);
    expect(tramos("000")).toEqual([]);
  });
});
