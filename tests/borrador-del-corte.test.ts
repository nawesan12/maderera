import { describe, expect, it } from "vitest";
import { borradorVale, duenoDelBorrador, VIDA_DEL_BORRADOR_SIN_VENTA_MS } from "@/lib/mostrador/borrador-del-corte";

/**
 * El borrador del corte es de la venta en curso (comité de T4): dos clientes
 * sin ficha son los dos `null`, y el despiece del que preguntó y se fue le
 * aparecía al siguiente.
 */
describe("el borrador del corte", () => {
  const ahora = 1_000_000;
  const actual = { clave: "v1", variantId: "melamina", clienteId: null, ahora };

  it("con algo en la venta, vale para la misma placa y el mismo cliente", () => {
    const b = duenoDelBorrador({ ...actual, ventaVacia: false });
    expect(borradorVale(b, { ...actual, ahora: ahora + 60 * 60_000 })).toBe(true);
    expect(borradorVale(b, { ...actual, variantId: "mdf" })).toBe(false);
    expect(borradorVale(b, { ...actual, clienteId: "c1" })).toBe(false);
  });

  it("no pasa a otra venta, aunque los dos clientes sean sin ficha", () => {
    const b = duenoDelBorrador({ ...actual, ventaVacia: false });
    expect(borradorVale(b, { ...actual, clave: "v2" })).toBe(false);
  });

  it("con la venta vacía al cerrar, vence enseguida: es el que preguntó y se fue", () => {
    const b = duenoDelBorrador({ ...actual, ventaVacia: true });
    expect(borradorVale(b, { ...actual, ahora: ahora + 5_000 })).toBe(true);
    expect(borradorVale(b, { ...actual, ahora: ahora + VIDA_DEL_BORRADOR_SIN_VENTA_MS })).toBe(false);
  });
});
