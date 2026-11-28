import { describe, expect, it } from "vitest";
import { telefonoLegible } from "@/lib/formato";
import { buscarVariantes, coincidePorPalabra, normalizar, type VarianteLocal } from "@/lib/mostrador/offline/busqueda-local";
import { efectivoEnCola } from "@/lib/mostrador/offline/cola";
import { faltan } from "@/app/mostrador/lineas";

/*
 * Lo que encontró el segundo y el tercer mes simulado en el mostrador (rama
 * mes23-mostrador-caja), en lo que se calcula en el navegador.
 */

const variante = (id: string, producto: string, orden: number): VarianteLocal => ({
  variantId: id,
  sku: id,
  producto,
  medida: "",
  unidad: "unidad",
  sortOrder: orden,
  busqueda: normalizar(`${producto} ${id}`),
});

describe("el buscador por el principio de la palabra (M2S1-187)", () => {
  const indice = [
    variante("FEN18", "Placa fenólica 18 mm", 1),
    variante("YESO", "Placa de yeso", 2),
    variante("LAC4", "Laca poliuretánica 4 litros", 3),
    variante("LAC1", "Laca poliuretánica 1 litro", 4),
  ];

  it("«laca» trae las lacas y no las placas", () => {
    expect(buscarVariantes(indice, "laca").map((v) => v.variantId)).toEqual(["LAC4", "LAC1"]);
  });

  it("sin nada que empiece así, lo de adentro de una palabra sigue apareciendo", () => {
    expect(buscarVariantes(indice, "enolic").map((v) => v.variantId)).toEqual(["FEN18"]);
  });

  it("el principio de una palabra cuenta después de un guion o un número", () => {
    expect(coincidePorPalabra(["mdf"], normalizar("pla-mdf-018"))).toBe(true);
    expect(coincidePorPalabra(["laca"], normalizar("placa"))).toBe(false);
  });
});

describe("el WhatsApp del ticket se lee (M2S1-186)", () => {
  it("sin el 54 ni el 9, con el área y el guion", () => {
    expect(telefonoLegible("5492235903118")).toBe("223 590-3118");
    expect(telefonoLegible("542235903118")).toBe("223 590-3118");
    expect(telefonoLegible("+54 9 11 4444-5555")).toBe("11 4444-5555");
  });

  it("lo que no se entiende queda como vino", () => {
    expect(telefonoLegible("123")).toBe("123");
  });
});

describe("el efectivo que espera en la cola cuenta en la caja (M2S1-086)", () => {
  const item = { estado: "pendiente" as const, intentos: 0, proximoIntentoAt: 0, ultimoError: null };
  it("suma las ventas y los movimientos de la sucursal que no subieron", () => {
    const filas = [
      { ...item, clave: "a", venta: { branchId: "S1", efectivo: 58500 } },
      { ...item, clave: "b", estado: "confirmada" as const, venta: { branchId: "S1", efectivo: 1000 } },
      { ...item, clave: "c", venta: { branchId: "S2", efectivo: 7000 } },
      { ...item, clave: "d", tipo: "movimiento" as const, movimiento: { branchId: "S1", tipo: "ingreso" as const, monto: 5000 } },
      { ...item, clave: "e", tipo: "movimiento" as const, movimiento: { branchId: "S1", tipo: "retiro" as const, monto: 2000 } },
    ];
    expect(efectivoEnCola(filas as never, "S1")).toEqual({ ventas: 58500, ingresos: 5000, retiros: -2000 });
  });
});

describe("el renglón dice lo que falta antes de cobrar (M2S3-050)", () => {
  const linea = { variantId: "v", descripcion: "Perfil", unidad: "unidad", precioUnitario: 1 };
  it("con el disponible que trajo el buscador", () => {
    expect(faltan({ ...linea, cantidad: 3, disponible: 0 })).toBe(3);
    expect(faltan({ ...linea, cantidad: 3, disponible: 1 })).toBe(2);
    expect(faltan({ ...linea, cantidad: 3, disponible: 5 })).toBe(0);
  });
  it("la media placa usa media", () => {
    expect(faltan({ ...linea, cantidad: 2, disponible: 0.5, presentacion: "media_largo" })).toBe(0.5);
  });
  it("sin saberlo, nada", () => {
    expect(faltan({ ...linea, cantidad: 3 })).toBe(0);
  });
});
