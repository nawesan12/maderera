import { describe, expect, it } from "vitest";
import { buscarVariantes, normalizar, type VarianteLocal } from "@/lib/mostrador/offline/busqueda-local";

const mdf = (id: string, espesor: string, orden: number): VarianteLocal => ({
  variantId: id,
  sku: `PLA-MDF-${espesor.padStart(3, "0")}`,
  producto: "MDF",
  medida: `1830 x 2600mm ${espesor}mm`,
  unidad: "placa",
  sortOrder: orden,
  busqueda: normalizar(`MDF 1830 x 2600mm ${espesor}mm PLA-MDF-${espesor.padStart(3, "0")} Placas`),
});

describe("el buscador del mostrador ordena por lo tipeado", () => {
  it("«mdf 18» marca el de 18 mm y no el de 3 mm que dice 1830 (mes simulado, H017)", () => {
    const indice = [mdf("3", "3", 1), mdf("9", "9", 2), mdf("18", "18", 3)];
    expect(buscarVariantes(indice, "mdf 18")[0]?.variantId).toBe("18");
  });

  it("sin números, el orden de siempre", () => {
    const indice = [mdf("3", "3", 1), mdf("18", "18", 3)];
    expect(buscarVariantes(indice, "mdf").map((v) => v.variantId)).toEqual(["3", "18"]);
  });
});
