import { describe, expect, it } from "vitest";
import {
  GUION,
  PASO_INICIAL,
  pasoPorId,
  ramasRotas,
} from "@/lib/asistente/guion";

/**
 * El guion es un dato, así que se puede recorrer entero y comprobar que no
 * tenga agujeros. Es barato y atrapa el error más fácil de cometer: agregar una
 * rama, escribir mal el destino, y dejar un botón que no lleva a ningún lado
 * en el sitio público.
 */
describe("guion del asistente", () => {
  it("todos los botones llevan a un paso que existe", () => {
    expect(ramasRotas()).toEqual([]);
  });

  it("no hay dos pasos con el mismo id", () => {
    const ids = GUION.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("arranca en un paso que existe y con opciones", () => {
    const inicio = pasoPorId(PASO_INICIAL);
    expect(inicio).not.toBeNull();
    expect(inicio!.opciones.length).toBeGreaterThan(0);
  });

  it("de todo paso se puede volver al principio", () => {
    // Sin esto, una rama termina y la persona queda encerrada en el panel.
    for (const paso of GUION) {
      if (paso.id === PASO_INICIAL) continue;

      const vuelve =
        paso.opciones.some((o) => o.va === PASO_INICIAL) ||
        paso.opciones.length > 0;

      expect(vuelve, `el paso "${paso.id}" no vuelve`).toBe(true);
    }
  });

  it("todos los pasos se pueden alcanzar desde el inicio", () => {
    const visitados = new Set<string>([PASO_INICIAL]);
    const cola = [PASO_INICIAL];

    while (cola.length > 0) {
      const actual = pasoPorId(cola.shift()!)!;
      for (const opcion of actual.opciones) {
        if (!visitados.has(opcion.va)) {
          visitados.add(opcion.va);
          cola.push(opcion.va);
        }
      }
    }

    const huerfanos = GUION.filter((p) => !visitados.has(p.id)).map((p) => p.id);
    expect(huerfanos).toEqual([]);
  });

  it("ningún paso se queda sin nada que decir", () => {
    for (const paso of GUION) {
      expect(paso.mensaje.trim().length, `el paso "${paso.id}" está mudo`).toBeGreaterThan(0);
    }
  });

  it("la rama de rubros la completa el catálogo, no el guion", () => {
    // Escribir los rubros a mano acá los deja viejos el día que alguien agrega
    // uno desde el panel. Este caso fija esa decisión.
    const rubros = pasoPorId("rubros")!;
    const propias = rubros.opciones.filter((o) => o.va !== PASO_INICIAL);
    expect(propias).toEqual([]);
  });
});
