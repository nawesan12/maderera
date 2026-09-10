import { describe, expect, it } from "vitest";
import {
  diasDeCobertura,
  sugerenciaDeCompra,
  ventaDiaria,
} from "@/lib/reposicion";

/**
 * La aritmética del reporte de compras. De acá salen sugerencias que alguien
 * convierte en una orden de compra real, así que los bordes importan.
 */
describe("reposición", () => {
  it("la cobertura son los días que aguanta el stock al ritmo del período", () => {
    // 60 vendidas en 30 días = 2 por día; 30 en stock = 15 días.
    expect(
      diasDeCobertura({ disponible: 30, vendido: 60, diasDelPeriodo: 30 }),
    ).toBe(15);
  });

  it("sin ventas no hay cobertura, no un infinito disfrazado", () => {
    expect(
      diasDeCobertura({ disponible: 30, vendido: 0, diasDelPeriodo: 30 }),
    ).toBeNull();
  });

  it("la sugerencia completa hasta la cobertura objetivo", () => {
    // 2 por día × 30 días objetivo = 60; hay 30 → comprar 30.
    expect(
      sugerenciaDeCompra(
        { disponible: 30, vendido: 60, diasDelPeriodo: 30 },
        30,
      ),
    ).toBe(30);
  });

  it("con stock de sobra no sugiere comprar", () => {
    expect(
      sugerenciaDeCompra(
        { disponible: 500, vendido: 60, diasDelPeriodo: 30 },
        30,
      ),
    ).toBe(0);
  });

  it("redondea hacia arriba: media placa no se compra", () => {
    // 1 cada 2 días × 7 días = 3,5; hay 0 → comprar 4.
    expect(
      sugerenciaDeCompra({ disponible: 0, vendido: 15, diasDelPeriodo: 30 }, 7),
    ).toBe(4);
  });

  it("el stock negativo no infla la compra", () => {
    // Un negativo es un error de inventario visible; comprar "lo que falta
    // más la deuda fantasma" duplicaría el error en plata.
    expect(
      sugerenciaDeCompra(
        { disponible: -10, vendido: 30, diasDelPeriodo: 30 },
        30,
      ),
    ).toBe(30);
  });

  it("sin período no hay ritmo", () => {
    expect(ventaDiaria(10, 0)).toBe(0);
  });
});
