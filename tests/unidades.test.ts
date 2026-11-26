import { describe, expect, it } from "vitest";
import {
  admiteDecimales,
  cantidadDeStock,
  formatearCantidad,
  formatearDecimal,
  leerCantidad,
  metrosDePiezas,
  pasoDeCantidad,
  piezasDeMetros,
  llevaDecimales,
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

  it("una cantidad con tres decimales no son miles (la nota de crédito parcial)", () => {
    expect(leerCantidad("0.125")).toBe(0.125);
    expect(leerCantidad("1.250")).toBe(1.25);
    expect(leerCantidad("0,125")).toBe(0.125);
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

// Hallazgo 32 (T7): los m² de Cortes salían «4.32».
describe("formatearDecimal", () => {
  it("escribe con coma y sin ceros de más en el texto", () => {
    expect(formatearDecimal(4.32)).toBe("4,32");
    expect(formatearDecimal(0.5)).toBe("0,5");
    expect(formatearDecimal(12)).toBe("12");
    expect(formatearDecimal(1234.5)).toBe("1.234,5");
    expect(formatearDecimal(0)).toBe("0");
    expect(formatearDecimal(4.325)).toBe("4,33");
  });

  it("en tablas y tarjetas lleva siempre los mismos decimales", () => {
    expect(formatearDecimal(4.3, 2, { fijo: true })).toBe("4,30");
    expect(formatearDecimal(12, 2, { fijo: true })).toBe("12,00");
    expect(formatearDecimal(1234.5, 2, { fijo: true })).toBe("1.234,50");
  });

  it("lo que redondea a cero no lleva signo", () => {
    expect(formatearDecimal(-0.004)).toBe("0");
    expect(formatearDecimal(-0.004, 2, { fijo: true })).toBe("0,00");
    expect(formatearDecimal(-2.5)).toBe("-2,5");
  });
});

/**
 * En el remito, la coma de lo que va entero se frenaba en silencio: «1,5»
 * quedaba «15» (comité final). Ahora se deja escribir y se marca.
 */
describe("lo tipeado con decimales", () => {
  it("ve la coma y el punto", () => {
    expect(llevaDecimales("1,5")).toBe(true);
    expect(llevaDecimales("2.")).toBe(true);
    expect(llevaDecimales("15")).toBe(false);
    expect(llevaDecimales("")).toBe(false);
  });
});

