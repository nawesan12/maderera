import { describe, expect, it } from "vitest";
import {
  admiteDecimales,
  cantidadDeStock,
  formatearCantidad,
  leerCantidad,
  metrosDePiezas,
  pasoDeCantidad,
  piezasDeMetros,
} from "@/lib/unidades";
import { unitOfSale } from "@/lib/db/schema/catalog";
import { UNIDADES_DE_PRODUCTO } from "@/lib/validation/product";

describe("stock con decimales", () => {
  it("admite fracciones solo en lo que se mide (y en la placa, por las medias)", () => {
    expect(admiteDecimales("metro_lineal")).toBe(true);
    expect(admiteDecimales("placa")).toBe(true);
    expect(admiteDecimales("unidad")).toBe(false);
    expect(admiteDecimales("tabla")).toBe(false);
    expect(admiteDecimales(null)).toBe(false);
  });

  it("redondea a la precisión de la columna y no acumula basura de coma flotante", () => {
    expect(cantidadDeStock(0.1 + 0.2)).toBe(0.3);
    expect(cantidadDeStock(3 - 2.9)).toBe(0.1);
  });

  it("escribe en castellano y sin ceros de más", () => {
    expect(formatearCantidad(3.5)).toBe("3,5");
    expect(formatearCantidad(28.8)).toBe("28,8");
    expect(formatearCantidad(12)).toBe("12");
  });

  it("lee lo que se tipea con coma o con punto", () => {
    expect(leerCantidad("2,5")).toBe(2.5);
    expect(leerCantidad("2.5")).toBe(2.5);
    expect(leerCantidad(" 3 ")).toBe(3);
    expect(leerCantidad("dos")).toBeNaN();
    expect(leerCantidad("")).toBeNaN();
  });

  it("el paso de la cantidad sigue a la unidad", () => {
    expect(pasoDeCantidad("placa")).toBe(0.5);
    expect(pasoDeCantidad("metro_lineal")).toBe(0.1);
    expect(pasoDeCantidad("unidad")).toBe(1);
  });
});

/**
 * «Al menos poder cargar stock por largo» (30/9/2026): el zócalo se cuenta en
 * piezas de 2,40 al descargar el camión y se vende por metro.
 */
describe("metro lineal por piezas", () => {
  it("doce piezas de 2,40 son 28,8 metros", () => {
    expect(metrosDePiezas(12, 2400)).toBe(28.8);
  });

  it("y 28,8 metros se leen como doce piezas, sin que la coma flotante se coma una", () => {
    expect(piezasDeMetros(28.8, 2400)).toEqual({ piezas: 12, resto: 0 });
  });

  it("lo vendido por metro deja un recorte que se dice aparte", () => {
    expect(piezasDeMetros(25.1, 2400)).toEqual({ piezas: 10, resto: 1.1 });
  });
});

describe("el formulario de producto ofrece todas las unidades de la base", () => {
  /** Faltaba `tabla` y un deck no se podía guardar desde el panel. */
  it("la lista de la validación es la del enum", () => {
    expect([...UNIDADES_DE_PRODUCTO].sort()).toEqual([...unitOfSale.enumValues].sort());
  });
});
