import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Una PC que deja de ser terminal borra el padrón, los precios y lo ya
 * confirmado, pero no lo que todavía no subió: ni la venta de la cola ni su
 * ticket, que es el único papel para reimprimirla (vuelta de control del
 * comité del 25/11).
 */
const almacen: Record<string, Map<string, unknown>> = {};

vi.mock("@/lib/mostrador/offline/db", () => ({
  leerTodo: async (a: string) => [...(almacen[a]?.values() ?? [])],
  borrarVarios: async (a: string, claves: string[]) => {
    for (const c of claves) almacen[a]?.delete(c);
  },
  vaciar: async (a: string) => almacen[a]?.clear(),
  borrar: async (a: string, c: string) => {
    almacen[a]?.delete(c);
  },
  guardarMeta: async () => {},
  leerMeta: async () => null,
}));

function cargar(a: string, filas: { clave: string; [k: string]: unknown }[]) {
  almacen[a] = new Map(filas.map((f) => [f.clave, f]));
}

describe("limpiarDatosDeLaCaja", () => {
  beforeEach(() => {
    cargar("clientes", [{ clave: "c1" }]);
    cargar("precios", [{ clave: "p1" }]);
    cargar("meta", [{ clave: "catalogo" }, { clave: "contadores" }]);
    cargar("cola", [
      { clave: "v-ok", estado: "confirmada" },
      { clave: "v-pend", estado: "pendiente" },
      { clave: "v-atas", estado: "atascada" },
    ]);
    cargar("tickets", [{ clave: "v-ok" }, { clave: "v-pend" }, { clave: "v-atas" }]);
  });

  it("conserva la venta sin subir y su ticket; borra el resto", async () => {
    const { limpiarDatosDeLaCaja } = await import("@/lib/mostrador/offline/use-caja");
    await limpiarDatosDeLaCaja();
    expect([...almacen.clientes.keys()]).toEqual([]);
    expect([...almacen.precios.keys()]).toEqual([]);
    expect([...almacen.cola.keys()].sort()).toEqual(["v-atas", "v-pend"]);
    expect([...almacen.tickets.keys()].sort()).toEqual(["v-atas", "v-pend"]);
    expect([...almacen.meta.keys()]).toEqual(["contadores"]);
  });
});
