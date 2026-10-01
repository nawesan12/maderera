import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MARCAS_DE_PAGO, marcaDelMedio } from "@/lib/medios-de-pago";

/**
 * Los logos de la portada.
 *
 * Las promociones se cargan a mano desde el panel, y cada quien escribe el
 * banco como le sale. Se prueba que las formas habituales encuentren su logo
 * y que las marcas sin logo sigan yendo con el nombre escrito.
 */
describe("la marca de una promoción", () => {
  it("se encuentra como la escriban", () => {
    expect(marcaDelMedio("Banco Nación")?.clave).toBe("banco-nacion");
    expect(marcaDelMedio("banco nacion")?.clave).toBe("banco-nacion");
    expect(marcaDelMedio("Banco de la Nación Argentina")?.clave).toBe("banco-nacion");
    expect(marcaDelMedio("Tarjeta Naranja")?.clave).toBe("naranja-x");
    expect(marcaDelMedio("Naranja X")?.clave).toBe("naranja-x");
    expect(marcaDelMedio("MercadoPago")?.clave).toBe("mercado-pago");
    expect(marcaDelMedio("MODO")?.clave).toBe("modo");
    expect(marcaDelMedio("Banco Hipotecario")?.clave).toBe("banco-hipotecario");
  });

  it("las que no tienen logo siguen con el nombre", () => {
    expect(marcaDelMedio("Tarjeta Fava")).toBeNull();
    expect(marcaDelMedio("Clipper")).toBeNull();
    expect(marcaDelMedio("Sport Club")).toBeNull();
    expect(marcaDelMedio("")).toBeNull();
  });

  it("cada logo existe en public", () => {
    for (const m of MARCAS_DE_PAGO) {
      expect(existsSync(join(process.cwd(), "public", m.logo)), m.logo).toBe(true);
    }
  });
});
