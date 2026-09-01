import { describe, expect, it } from "vitest";
import { combinedStockLevel, disponible, stockLevel } from "@/lib/stock-level";
import { calcularEnvio } from "@/lib/envios";

/**
 * Disponible = físico − reservado.
 *
 * Es lo que impide vender dos veces la misma placa: la mercadería comprada y
 * sin retirar sigue en el galpón, pero ya tiene dueño.
 */
describe("disponible", () => {
  it("descuenta lo reservado del físico", () => {
    expect(disponible(20, 5)).toBe(15);
  });

  it("sin reservas es el físico", () => {
    expect(disponible(20, 0)).toBe(20);
  });

  it("nunca da negativo", () => {
    // Pasa cuando se entregó algo sin cargarlo. Un número rojo en la tienda
    // sería peor que un cero.
    expect(disponible(3, 10)).toBe(0);
  });
});

describe("nivel de stock", () => {
  it("sin unidades es sin-stock", () => {
    expect(stockLevel(0, 5)).toBe("sin-stock");
    expect(stockLevel(-2, 5)).toBe("sin-stock");
  });

  it("en el mínimo o por debajo hay que reponer", () => {
    expect(stockLevel(5, 5)).toBe("bajo");
    expect(stockLevel(3, 5)).toBe("bajo");
  });

  it("hasta el triple del mínimo es medio", () => {
    expect(stockLevel(15, 5)).toBe("medio");
    expect(stockLevel(16, 5)).toBe("alto");
  });

  it("sin mínimo configurado, cualquier cantidad es alta", () => {
    expect(stockLevel(1, 0)).toBe("alto");
  });

  it("el nivel combinado se queda con el mejor de las sucursales", () => {
    expect(combinedStockLevel(["sin-stock", "alto"])).toBe("alto");
    expect(combinedStockLevel(["sin-stock", "bajo"])).toBe("bajo");
    expect(combinedStockLevel([])).toBe("sin-stock");
  });
});

describe("costo de envío", () => {
  const zona = {
    id: "z",
    nombre: "Mar del Plata",
    costo: 15000,
    envioGratisDesde: 200000,
    demoraEstimada: null,
  };

  it("cobra la tarifa de la zona", () => {
    expect(calcularEnvio(zona, 100000)).toBe(15000);
  });

  it("no cobra al llegar al monto de envío gratis", () => {
    expect(calcularEnvio(zona, 200000)).toBe(0);
    expect(calcularEnvio(zona, 250000)).toBe(0);
  });

  it("con la promoción desactivada siempre cobra", () => {
    expect(calcularEnvio({ ...zona, envioGratisDesde: 0 }, 9_000_000)).toBe(15000);
  });
});
