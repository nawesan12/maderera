import { describe, expect, it } from "vitest";
import {
  fraccionDePlaca,
  medidaDePlaca,
  nombreDeLaMitad,
} from "@/lib/cortes/placa";

/**
 * De qué medida es la placa que se corta.
 *
 * Se prueba porque hasta ahora era una cadena de `??` repetida en cuatro
 * pantallas —la ficha del corte, el alta, el mostrador y la hoja impresa— y
 * cada una podía quedar distinta. Y porque la media placa cambia el resultado
 * del plano entero: si el sentido se aplica al revés, las piezas entran donde
 * no entran y el presupuesto sale mal.
 */
describe("medida de la placa", () => {
  const variante = { varianteLargo: 2750, varianteAncho: 1830 };

  it("usa la medida cargada a mano antes que la de la variante", () => {
    expect(
      medidaDePlaca({ propiaLargo: 3000, propiaAncho: 1500, ...variante }),
    ).toMatchObject({ largo: 3000, ancho: 1500, supuesta: false });
  });

  it("usa la variante cuando no se cargó nada", () => {
    expect(medidaDePlaca(variante)).toMatchObject({
      largo: 2750,
      ancho: 1830,
      supuesta: false,
    });
  });

  it("avisa que la medida es un supuesto cuando no hay ninguna", () => {
    // Material que trajo el cliente: no hay variante ni medida cargada. Se
    // corta con la medida de plaza, pero la pantalla tiene que decirlo.
    expect(medidaDePlaca({})).toMatchObject({
      largo: 2750,
      ancho: 1830,
      supuesta: true,
    });
  });

  it("no mezcla media medida propia con media de la variante", () => {
    // Alguien cargó el largo y se olvidó el ancho: tomar uno de cada lado
    // daría una placa que no existe.
    expect(
      medidaDePlaca({ propiaLargo: 3000, ...variante }),
    ).toMatchObject({ largo: 2750, ancho: 1830 });
  });

  it("parte a lo largo dejando la veta entera", () => {
    expect(medidaDePlaca({ ...variante, mitad: "largo" })).toMatchObject({
      largo: 2750,
      ancho: 915,
    });
  });

  it("parte al ancho cortando la veta", () => {
    expect(medidaDePlaca({ ...variante, mitad: "ancho" })).toMatchObject({
      largo: 1375,
      ancho: 1830,
    });
  });

  it("no inventa milímetros al partir una medida impar", () => {
    // Redondea para abajo: una placa de 1221 da dos de 610, no dos de 610,5.
    // Prometer el milímetro que no está es lo que hace que la última pieza no
    // entre.
    expect(
      medidaDePlaca({ propiaLargo: 1221, propiaAncho: 1000, mitad: "ancho" })
        .largo,
    ).toBe(610);
  });
});

describe("media placa se cobra media", () => {
  it("cobra la mitad cuando el trabajo sale de media placa", () => {
    expect(fraccionDePlaca("largo")).toBe(0.5);
    expect(fraccionDePlaca("ancho")).toBe(0.5);
  });

  it("cobra entera cuando es placa entera", () => {
    expect(fraccionDePlaca(null)).toBe(1);
  });

  it("lo dice con las palabras del taller", () => {
    expect(nombreDeLaMitad("largo")).toBe("Media placa, partida a lo largo");
    expect(nombreDeLaMitad(null)).toBe("Placa entera");
  });
});
