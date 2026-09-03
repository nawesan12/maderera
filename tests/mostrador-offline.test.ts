import { describe, expect, it } from "vitest";
import {
  buscarClientesLocal,
  buscarVariantes,
  coincideLocal,
  normalizar,
  terminosDe,
  type ClienteLocal,
  type VarianteLocal,
} from "@/lib/mostrador/offline/busqueda-local";
import {
  clavePrecio,
  precioLocal,
  type PreciosLocales,
} from "@/lib/mostrador/offline/precio-local";

/**
 * El riesgo de tener dos búsquedas —la de la base y la del navegador— es que
 * devuelvan cosas distintas sin que nadie se entere: alguien busca offline, no
 * encuentra lo que sí está, y le dice al cliente que no hay. Estos casos fijan
 * el acuerdo.
 */
describe("normalizar", () => {
  it("saca acentos y mayúsculas, como f_unaccent en la base", () => {
    expect(normalizar("Fenólico")).toBe("fenolico");
    expect(normalizar("MELAMÍNICA")).toBe("melaminica");
    expect(normalizar("Ñandubay")).toBe("nandubay");
    expect(normalizar("  dos   espacios  ")).toBe("dos espacios");
  });

  it("no toca los números ni la equis de las medidas", () => {
    expect(normalizar("1220x2440mm — 18mm")).toBe("1220x2440mm — 18mm");
  });
});

describe("términos", () => {
  it("corta en seis, igual que el SQL", () => {
    expect(terminosDe("a b c d e f g h")).toHaveLength(6);
  });

  it("un texto vacío no da términos", () => {
    expect(terminosDe("   ")).toEqual([]);
  });
});

describe("coincidencia", () => {
  const heno = "fenolico 1220x2440mm 18mm pla-fen-018 fenolicos placas";

  it("agregar palabras afina, no amplía", () => {
    expect(coincideLocal(["fenolico"], heno)).toBe(true);
    expect(coincideLocal(["fenolico", "18mm"], heno)).toBe(true);
    // "roble" no está: con Y entre términos, la coincidencia se cae.
    expect(coincideLocal(["fenolico", "roble"], heno)).toBe(false);
  });
});

const variantes: VarianteLocal[] = [
  {
    variantId: "1", sku: "PLA-FEN-018", producto: "Fenólico",
    medida: "1220 x 2440mm — 18mm", unidad: "unidad", sortOrder: 2,
    busqueda: normalizar("Fenólico 1220 x 2440mm — 18mm PLA-FEN-018 Placas"),
  },
  {
    variantId: "2", sku: "PLA-FEN-015", producto: "Fenólico",
    medida: "1220 x 2440mm — 15mm", unidad: "unidad", sortOrder: 1,
    busqueda: normalizar("Fenólico 1220 x 2440mm — 15mm PLA-FEN-015 Placas"),
  },
  {
    variantId: "3", sku: "PLA-MEL-BLA-18", producto: "Melamina Blanca",
    medida: "1830 x 2600mm — 18mm", unidad: "unidad", sortOrder: 3,
    busqueda: normalizar("Melamina Blanca 1830 x 2600mm — 18mm PLA-MEL-BLA-18 Placas"),
  },
];

describe("buscar variantes", () => {
  it("encuentra sin acentos y con las palabras en cualquier orden", () => {
    expect(buscarVariantes(variantes, "fenolico").map((v) => v.variantId))
      .toEqual(["2", "1"]);
    expect(buscarVariantes(variantes, "18mm fenolico").map((v) => v.variantId))
      .toEqual(["1"]);
  });

  it("el código exacto va primero", () => {
    // Quien pasa un código de barras espera eso arriba, no un producto que lo
    // contiene en el medio.
    const r = buscarVariantes(variantes, "PLA-MEL-BLA-18");
    expect(r[0].variantId).toBe("3");
  });

  it("empata por sortOrder, como el orden del servidor", () => {
    const r = buscarVariantes(variantes, "placas");
    expect(r.map((v) => v.sortOrder)).toEqual([1, 2, 3]);
  });

  it("respeta el tope", () => {
    expect(buscarVariantes(variantes, "placas", 2)).toHaveLength(2);
  });

  it("sin texto no devuelve el catálogo entero", () => {
    // Devolver todo con la caja vacía es cómo una lista de 8.000 filas termina
    // dibujándose en un teléfono.
    expect(buscarVariantes(variantes, "")).toEqual([]);
    expect(buscarVariantes(variantes, "   ")).toEqual([]);
  });
});

describe("buscar clientes", () => {
  const clientes: ClienteLocal[] = [
    {
      id: "a", nombre: "Roberto Fernández", razonSocial: "RF Construcciones SRL",
      cuit: "30712345678", condicionIva: "responsable_inscripto", priceListId: "pro",
      busqueda: normalizar("Roberto Fernández RF Construcciones SRL 30712345678"),
    },
    {
      id: "b", nombre: "Ana Torres", razonSocial: null, cuit: null,
      condicionIva: "consumidor_final", priceListId: null,
      busqueda: normalizar("Ana Torres"),
    },
  ];

  it("busca por nombre, razón social y CUIT", () => {
    expect(buscarClientesLocal(clientes, "roberto")[0].id).toBe("a");
    expect(buscarClientesLocal(clientes, "construcciones")[0].id).toBe("a");
    expect(buscarClientesLocal(clientes, "30712345678")[0].id).toBe("a");
  });

  it("ordena por nombre", () => {
    expect(buscarClientesLocal(clientes, "a").map((c) => c.id)).toEqual(["b", "a"]);
  });
});

/**
 * El precio es lo que más caro sale equivocar: mostrar el de público a un
 * profesional pierde la venta, y el profesional a cualquiera regala margen.
 */
describe("precio local", () => {
  const precios: PreciosLocales = new Map([
    [clavePrecio("general", "v1"), 100],
    [clavePrecio("pro", "v1"), 85],
    [clavePrecio("general", "v2"), 200],
    // v2 no tiene precio en la lista profesional
  ]);

  it("con lista propia usa la propia", () => {
    expect(precioLocal(precios, "v1", "pro", "general")).toBe(85);
  });

  it("sin lista propia usa la general", () => {
    expect(precioLocal(precios, "v1", null, "general")).toBe(100);
  });

  it("cae a la general cuando la propia no tiene ese artículo", () => {
    // Media lista sin precio es peor que el precio de público: es la misma
    // regla que ya aplica el servidor.
    expect(precioLocal(precios, "v2", "pro", "general")).toBe(200);
  });

  it("sin ningún precio devuelve cero, que la pantalla lee como a consultar", () => {
    expect(precioLocal(precios, "v9", "pro", "general")).toBe(0);
  });
});
