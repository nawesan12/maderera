import { describe, expect, it } from "vitest";
import {
  ENTIDADES_CONOCIDAS,
  etiquetaDeEntidad,
  rutaDeEntidad,
} from "@/lib/dal/admin/rutas-entidad";
import { etiquetaDeRol, ETIQUETA_ROL } from "@/lib/roles";

/**
 * Que nada salga a la pantalla con el nombre que usa la base.
 *
 * La bitácora armaba su filtro "Sobre qué" con los valores crudos de la tabla,
 * así que quien la usaba elegía entre `orden_compra` y `retencion_sufrida`. El
 * arreglo fue un diccionario, y un diccionario se desactualiza solo: alguien
 * agrega una entidad, no pasa por él, y la fuga vuelve sin que nadie lo note.
 * Esto es la alarma.
 */
describe("etiquetaDeEntidad", () => {
  it("le pone nombre en castellano a todas las entidades conocidas", () => {
    const crudas = ENTIDADES_CONOCIDAS.filter(
      (e) => etiquetaDeEntidad(e) === e && e === e.toLowerCase(),
    );
    expect(crudas).toEqual([]);
  });

  it("ninguna queda con guion bajo ni arrancando en minúscula", () => {
    for (const entidad of ENTIDADES_CONOCIDAS) {
      const etiqueta = etiquetaDeEntidad(entidad);
      expect(etiqueta).not.toContain("_");
      expect(etiqueta[0]).toBe(etiqueta[0]?.toUpperCase());
    }
  });

  it("toda entidad con nombre propio tiene también a dónde llevar", () => {
    // Las tablas viven en el mismo archivo justamente para que no se separen:
    // un chip con nombre lindo y sin enlace es media solución.
    const sinRuta = ENTIDADES_CONOCIDAS.filter((e) => rutaDeEntidad(e) === null);
    expect(sinRuta).toEqual([]);
  });

  it("aguanta una entidad que todavía no está en la tabla", () => {
    expect(etiquetaDeEntidad("nota_credito")).toBe("Nota credito");
  });
});

describe("etiquetaDeRol", () => {
  it("nombra los cuatro roles como la barra del panel", () => {
    expect(etiquetaDeRol("deposito")).toBe("Depósito");
    expect(etiquetaDeRol("admin")).toBe("Administración");
    expect(Object.keys(ETIQUETA_ROL)).toHaveLength(4);
  });

  it("sin rol no inventa nada", () => {
    expect(etiquetaDeRol(null)).toBeNull();
  });
});
