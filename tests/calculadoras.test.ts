import { describe, expect, it } from "vitest";
import {
  ANCHO_DE_SIERRA_MM,
  MEDIDAS_DE_PLACA,
  calculateBoards,
  calculateDeck,
  calculateFloor,
  calculateRoof,
} from "@/lib/calculations";

/**
 * Las calculadoras no tenían un solo test, y son de las pocas cosas del sitio
 * que un cliente usa para decidir cuánto material comprar. Un error acá no se
 * ve en pantalla: se ve con el techo a medio hacer.
 */

describe("techos", () => {
  it("pone los tirantes cada 60 cm, más el del extremo", () => {
    // 6 m de ancho / 0,60 = 10 vanos → 11 tirantes.
    expect(calculateRoof(8, 6).tirantes.cantidad).toBe(11);
  });

  it("suma el 20 % de encastre al machimbre, no el 8 %", () => {
    // 10 × 6 = 60 m², con 15 % de pendiente = 69 m², más 20 % = 82,8 → 83.
    // Con el 8 % que tenía antes daban 75: ocho metros cuadrados de menos.
    expect(calculateRoof(10, 6).machimbre.m2).toBe(83);
  });

  it("descuenta el solape de la membrana", () => {
    // 69 m² a 9 m² por rollo son 8 rollos. Sin descontar solape daban 7, y el
    // techo quedaba corto justo en la última tirada.
    expect(calculateRoof(10, 6).membrana.rollos).toBe(8);
  });

  it("marca los clavos como estimados", () => {
    // El propio cliente dice que dependen del uso: presentarlos como exactos
    // sería el único dato de la pantalla que se sabe que no lo es.
    expect(calculateRoof(10, 6).clavos.estimado).toBe(true);
  });
});

describe("placas", () => {
  const placa = MEDIDAS_DE_PLACA[0];

  it("usa una medida que existe en plaza", () => {
    // El sistema calculaba sobre 1830 × 2820, que no es ninguna de las cuatro.
    const { placaDimension } = calculateBoards([{ ancho: 500, largo: 500, cantidad: 1 }]);
    expect(placaDimension).toBe("1830 x 2750mm");
    // Las cuatro del brief, ninguna otra: 1830 × 2820 era del prototipo.
    expect(MEDIDAS_DE_PLACA.map((m) => `${m.ancho}x${m.largo}`)).toEqual([
      "1830x2750",
      "1830x2600",
      "1220x2440",
      "1220x3050",
    ]);
  });

  it("le cobra a cada pieza el ancho de la sierra", () => {
    const una = calculateBoards([{ ancho: 1000, largo: 1000, cantidad: 1 }]);
    // (1000+5) × (1000+5) − 1000×1000 = 10.025 mm².
    expect(una.perdidaPorSierraMm2).toBe(
      (1000 + ANCHO_DE_SIERRA_MM) ** 2 - 1000 ** 2,
    );
  });

  it("muchas piezas chicas gastan más que pocas grandes con la misma área", () => {
    // Es exactamente lo que el cálculo por área pura no distinguía: cien
    // piezas de 10 cm y una de 1 m suman lo mismo, pero el aserrín no.
    const chicas = calculateBoards([{ ancho: 100, largo: 100, cantidad: 100 }]);
    const grande = calculateBoards([{ ancho: 1000, largo: 1000, cantidad: 1 }]);
    expect(chicas.perdidaPorSierraMm2).toBeGreaterThan(grande.perdidaPorSierraMm2);
  });

  it("nunca devuelve menos de una placa si hay piezas", () => {
    expect(calculateBoards([{ ancho: 10, largo: 10, cantidad: 1 }]).placasNecesarias).toBe(1);
  });

  it("sin piezas no pide ninguna placa", () => {
    expect(calculateBoards([]).placasNecesarias).toBe(0);
  });

  it("el aprovechamiento se mide contra lo que se lleva el cliente", () => {
    const r = calculateBoards([{ ancho: placa.ancho, largo: placa.largo, cantidad: 1 }]);
    // Una placa entera pedida como una sola pieza: la sierra y el margen
    // obligan a comprar dos, así que el aprovechamiento ronda la mitad.
    expect(r.aprovechamiento).toBeLessThan(100);
    expect(r.aprovechamiento + r.desperdicio).toBe(100);
  });
});

describe("pisos", () => {
  it("calcula los tirantes de entrepiso cada 40 cm", () => {
    // 4 m / 0,40 = 10 vanos → 11.
    expect(calculateFloor(5, 4).tirantesDeEntrepiso).toBe(11);
  });

  it("descuenta las puertas del perímetro de zócalo", () => {
    // Perímetro de un 5 × 4 son 18 m; con el 15 % de puertas, 15,3 → 16.
    expect(calculateFloor(5, 4).zocaloML).toBe(16);
  });
});

describe("deck", () => {
  it("pone las alfajías cada 40 cm", () => {
    expect(calculateDeck(4, 3).estructura.tirantes).toBe(11);
  });

  it("el PVC no lleva protector", () => {
    expect(calculateDeck(4, 3, "pvc").protector.litros).toBe(0);
  });
});
