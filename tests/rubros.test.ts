import { describe, expect, it } from "vitest";
import { nombresDeRubros } from "@/lib/catalogo/rubros";

// M2S4-034 (mes 23, no se pudo ver sin rubros en la base): el rubro que se
// repite en otra categoría lleva la suya en el selector de la reposición.
describe("nombresDeRubros", () => {
  it("nombra la categoría solo del repetido", () => {
    const n = nombresDeRubros([
      { categoria: "Placas", rubros: [{ id: "a", name: "Accesorios" }, { id: "b", name: "Fenólicos" }] },
      { categoria: "Herrajes", rubros: [{ id: "c", name: "Accesorios" }] },
    ]);
    expect(n.get("a")).toBe("Accesorios · Placas");
    expect(n.get("c")).toBe("Accesorios · Herrajes");
    expect(n.get("b")).toBe("Fenólicos");
  });
});
