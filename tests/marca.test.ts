import { describe, expect, it } from "vitest";
import { TRAZO_ISOTIPO, TRAZO_NOMBRE } from "@/lib/marca/logotipo";

/**
 * El logotipo va en línea en cada página pública (en el HTML y en el JS de la
 * barra, que es un componente de cliente). Salido del PDF pesaba 18 KB de
 * trazos; simplificado, 7 KB. Si alguien lo vuelve a exportar sin simplificar,
 * esto lo frena.
 */
describe("el logotipo en vectores", () => {
  it("pesa menos de 8 KB de trazos", () => {
    expect(TRAZO_ISOTIPO.length + TRAZO_NOMBRE.length).toBeLessThan(8000);
  });
  it("sigue siendo un trazo cerrado", () => {
    for (const d of [TRAZO_ISOTIPO, TRAZO_NOMBRE]) expect(d).toMatch(/^[Mm][\d.\s,\-a-zA-Z]+$/);
  });
});
