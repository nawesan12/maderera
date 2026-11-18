import { describe, expect, it } from "vitest";
import {
  esEtiquetaValida,
  etiquetaDeListado,
  etiquetaDeProducto,
} from "@/lib/etiquetas-de-cache";

/*
 * Las etiquetas que manda el aviso del stock (backend/db/migraciones/00169)
 * tienen que pasar por la ruta de revalidar: si una no pasa, el aviso entero
 * falla y el sitio sigue mostrando el stock viejo.
 */
describe("etiquetas de la caché", () => {
  it("el listado sin categoría es «todo»", () => {
    expect(etiquetaDeListado()).toBe("catalogo:todo");
    expect(etiquetaDeListado("todos")).toBe("catalogo:todo");
    expect(etiquetaDeListado("placas")).toBe("catalogo:placas");
    expect(etiquetaDeProducto("fenolico-18")).toBe("producto:fenolico-18");
  });

  it("acepta las fijas y las finas, y nada más", () => {
    for (const e of ["catalogo", "contenido", "catalogo:todo", "catalogo:placas", "producto:Pino-Ñandú"]) {
      expect(esEtiquetaValida(e), e).toBe(true);
    }
    for (const e of ["", "producto:", "producto:a b", "otra:cosa", `producto:${"x".repeat(201)}`]) {
      expect(esEtiquetaValida(e), e).toBe(false);
    }
  });
});
