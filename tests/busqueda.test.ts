import { describe, expect, it } from "vitest";
import { normalizarBusqueda } from "@/lib/busqueda";

/**
 * La forma canónica de un término de búsqueda.
 *
 * Esto no cambia qué encuentra la búsqueda —de eso se ocupa `f_unaccent` del
 * lado de la base—, cambia **cuántas entradas de caché genera**. El término
 * viaja en la clave, y la clave la escribe cualquiera desde la URL.
 */
describe("normalizarBusqueda", () => {
  it("no distingue mayúsculas, acentos ni espacios de más", () => {
    const esperado = "fenolico 18";
    expect(normalizarBusqueda("Fenólico 18")).toBe(esperado);
    expect(normalizarBusqueda("  FENOLICO   18 ")).toBe(esperado);
    expect(normalizarBusqueda("fenólico\t18")).toBe(esperado);
  });

  it("sin nada adentro no es un filtro", () => {
    expect(normalizarBusqueda("")).toBeUndefined();
    expect(normalizarBusqueda("   ")).toBeUndefined();
    expect(normalizarBusqueda(undefined)).toBeUndefined();
  });

  /*
   * El caso que importa para la plata: alguien iterando la URL con términos
   * cada vez más largos. Cada término distinto era una entrada de caché y tres
   * consultas; el tope corta la serie.
   */
  it("se queda con seis palabras y sesenta caracteres", () => {
    const largo = normalizarBusqueda("uno dos tres cuatro cinco seis siete ocho");
    expect(largo).toBe("uno dos tres cuatro cinco seis");

    const gigante = normalizarBusqueda("a".repeat(500));
    expect(gigante).toHaveLength(60);
  });

  it("es idempotente: normalizar lo normalizado no cambia nada", () => {
    const una = normalizarBusqueda("  Placa  Melamínica  Blanca ");
    expect(normalizarBusqueda(una)).toBe(una);
  });
});
