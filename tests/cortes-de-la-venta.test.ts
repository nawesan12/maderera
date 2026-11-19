import { describe, expect, it } from "vitest";
import { conElCorte, cortesSinRenglones, paraCobrar, sinElCorte } from "@/lib/mostrador/cortes-de-la-venta";
import { cantidadDelRenglon, vaSinDecimales, type LineaDeVenta } from "@/lib/mostrador/importes";
import { cuentaSinConexion } from "@/lib/mostrador/cuenta-sin-conexion";
import { estaCalculando } from "@/lib/cortes/en-vivo";
import { enterDelBuscador } from "@/lib/mostrador/atajos";
import type { CorteDeMostrador } from "@/lib/mostrador/tipos";

/**
 * Comité final, A2: reabrir un corte para corregirlo sumaba los renglones
 * nuevos a los viejos (dos placas y dos cortes cobrados) y al taller llegaba
 * un solo despiece. Cada corte va ahora con sus renglones atados.
 */

const despiece = (material: string): CorteDeMostrador => ({
  variantId: "placa",
  materialDescripcion: material,
  cantoDescripcion: null,
  placaLargoMm: 2440,
  placaAnchoMm: 1220,
  mitad: null,
  placas: 1,
  pasadas: 4,
  acomodoManual: null,
  piezas: [{ largoMm: 600, anchoMm: 400, cantidad: 4, respetaVeta: 0, cantoLargo: 0, cantoAncho: 0, etiqueta: null, aclaracion: null }],
});

const renglon = (p: Partial<LineaDeVenta>): LineaDeVenta => ({
  variantId: null,
  descripcion: "Corte a medida · 4 piezas",
  unidad: "pasada",
  cantidad: 4,
  precioUnitario: 2500,
  ...p,
});

const placa = { variantId: "placa" };

describe("los cortes de la venta", () => {
  it("corregir un corte reemplaza sus renglones, no los suma", () => {
    const tornillo = renglon({ variantId: "t", descripcion: "Tornillo", unidad: "unidad", cantidad: 10, precioUnitario: 15 });
    let r = conElCorte([tornillo], [], { id: "a", placa, corte: despiece("MDF"), estado: 1 }, [
      renglon({ variantId: "placa", descripcion: "MDF", unidad: "placa", cantidad: 1, precioUnitario: 50000 }),
      renglon({}),
    ]);
    expect(r.lineas).toHaveLength(3);
    // Reabierto y corregido: una pasada menos, en el mismo lugar.
    r = conElCorte(r.lineas, r.cortes, { id: "a", placa, corte: despiece("MDF"), estado: 2 }, [
      renglon({ variantId: "placa", descripcion: "MDF", unidad: "placa", cantidad: 1, precioUnitario: 50000 }),
      renglon({ cantidad: 3 }),
    ]);
    expect(r.lineas.map((l) => [l.descripcion, l.cantidad])).toEqual([
      ["Tornillo", 10],
      ["MDF", 1],
      ["Corte a medida · 4 piezas", 3],
    ]);
    expect(r.cortes).toHaveLength(1);
    expect(r.cortes[0].estado).toBe(2);
  });

  it("una venta lleva varios cortes y cada renglón viaja con el índice del suyo", () => {
    let r = conElCorte([], [], { id: "a", placa, corte: despiece("MDF"), estado: 0 }, [renglon({})]);
    r = conElCorte(r.lineas, r.cortes, { id: "b", placa, corte: despiece("Fenólico"), estado: 0 }, [renglon({ cantidad: 6 })]);
    const go = paraCobrar([...r.lineas, renglon({ variantId: "t", descripcion: "Tornillo", unidad: "unidad" })], r.cortes);
    expect(go.cortes.map((c) => c.materialDescripcion)).toEqual(["MDF", "Fenólico"]);
    expect(go.lineas.map((l) => l.corte)).toEqual([0, 1, undefined]);
    expect(go.lineas.some((l) => "corteId" in l)).toBe(false);
  });

  it("sacar un corte saca todos sus renglones y el corte", () => {
    let r = conElCorte([], [], { id: "a", placa, corte: despiece("MDF"), estado: 0 }, [renglon({}), renglon({ unidad: "m", descripcion: "Tapacanto" })]);
    r = conElCorte(r.lineas, r.cortes, { id: "b", placa, corte: despiece("Fenólico"), estado: 0 }, [renglon({})]);
    const sin = sinElCorte(r.lineas, r.cortes, "a");
    expect(sin.lineas).toHaveLength(1);
    expect(paraCobrar(sin.lineas, sin.cortes).lineas[0].corte).toBe(0);
    expect(paraCobrar(sin.lineas, sin.cortes).cortes.map((c) => c.materialDescripcion)).toEqual(["Fenólico"]);
  });

  // Revisión del carril F: sin tarifa y por debajo de media placa el corte no
  // cobra nada, y se descartaba: el trabajo no llegaba al taller.
  it("el corte que no cobra nada viaja igual y se ve aparte", () => {
    let r = conElCorte([], [], { id: "a", placa, corte: despiece("MDF"), estado: 0 }, []);
    r = conElCorte([...r.lineas, renglon({ variantId: "t", descripcion: "Tornillo", unidad: "unidad" })], r.cortes, { id: "b", placa, corte: despiece("Fenólico"), estado: 0 }, [renglon({})]);
    const go = paraCobrar(r.lineas, r.cortes);
    expect(go.cortes.map((c) => c.materialDescripcion)).toEqual(["MDF", "Fenólico"]);
    expect(go.lineas.map((l) => l.corte)).toEqual([undefined, 1]);
    expect(cortesSinRenglones(r.lineas, r.cortes).map((c) => c.id)).toEqual(["a"]);
    // Y se saca como cualquier corte.
    const sin = sinElCorte(r.lineas, r.cortes, "a");
    expect(paraCobrar(sin.lineas, sin.cortes).cortes).toHaveLength(1);
  });
});

/** M10: lo que se vende por unidad va entero; un renglón a mano no se toca. */
describe("la cantidad del renglón", () => {
  it("redondea lo que se vende por unidad", () => {
    expect(cantidadDelRenglon({ variantId: "b", unidad: "unidad" }, 2.5)).toBe(3);
    expect(cantidadDelRenglon({ variantId: "b", unidad: "unidad" }, 0.4)).toBe(1);
    expect(cantidadDelRenglon({ variantId: "b", unidad: "unidad" }, 4)).toBe(4);
  });
  it("deja los decimales de lo que se mide y de lo cargado a mano", () => {
    expect(cantidadDelRenglon({ variantId: "p", unidad: "placa" }, 1.5)).toBe(1.5);
    expect(cantidadDelRenglon({ variantId: "m", unidad: "metro_lineal" }, 2.75)).toBe(2.75);
    expect(cantidadDelRenglon({ variantId: null, unidad: "unidad" }, 2.5)).toBe(2.5);
  });
});

/** M14: Ctrl+Enter sigue cobrando, pero no sin precio ni sin conexión sobre una placa. */
describe("Ctrl+Enter en el buscador", () => {
  const base = { ctrl: true, shift: false, alt: false, texto: "mdf", hayResultado: true, seCorta: false, resuelto: true };
  it("un resultado sin precio no se agrega", () => {
    expect(enterDelBuscador({ ...base, sinPrecio: true })).toEqual({ que: "sinPrecio" });
    expect(enterDelBuscador({ ...base, ctrl: false, sinPrecio: true })).toEqual({ que: "sinPrecio" });
  });
  it("sin conexión, una placa se agrega y no se cobra", () => {
    expect(enterDelBuscador({ ...base, esPlaca: true, sinConexion: true })).toEqual({ que: "agregar", media: null, yCobrar: false });
    expect(enterDelBuscador({ ...base, esPlaca: false, sinConexion: true })).toMatchObject({ yCobrar: true });
    expect(enterDelBuscador({ ...base, esPlaca: true, sinConexion: false })).toMatchObject({ yCobrar: true });
  });
});

/** Revisión del carril F: «2,5*bisagra» no se redondea en silencio. */
describe("lo que va sin decimales desde el buscador", () => {
  it("no entra con decimales lo que se vende por unidad", () => {
    expect(vaSinDecimales({ variantId: "b", unidad: "unidad" }, 2.5)).toBe(true);
    expect(vaSinDecimales({ variantId: "b", unidad: "unidad" }, 0.4)).toBe(true);
    expect(vaSinDecimales({ variantId: "b", unidad: "unidad" }, 3)).toBe(false);
    expect(vaSinDecimales({ variantId: "p", unidad: "placa" }, 1.5)).toBe(false);
  });
});

/** Revisión del carril F: sin conexión no se le anota a una cuenta que la cola va a rechazar. */
describe("cuenta corriente sin conexión", () => {
  it("frena la cuenta bloqueada y la que no tiene límite", () => {
    expect(cuentaSinConexion({ nombre: "Ana", cuentaBloqueada: true, limiteCredito: 1000 })).toBe("La cuenta corriente de Ana está bloqueada.");
    expect(cuentaSinConexion({ nombre: "Ana", limiteCredito: 0 })).toBe("Ana no tiene cuenta corriente.");
    expect(cuentaSinConexion({ nombre: "Ana", limiteCredito: 1000 })).toBeNull();
    // Una copia vieja del padrón, sin esos datos: no frena (Go marca la venta).
    expect(cuentaSinConexion({ nombre: "Ana" })).toBeNull();
    expect(cuentaSinConexion(null)).toBeNull();
  });
});

/** Revisión del carril F: Ctrl+Enter rápido en el corte agregaba el plano anterior. */
describe("el plano en vivo", () => {
  it("está calculando desde que cambia lo cargado hasta que llega su respuesta", () => {
    expect(estaCalculando('{"a":1}', null)).toBe(true);
    expect(estaCalculando('{"a":2}', '{"a":1}')).toBe(true);
    expect(estaCalculando('{"a":2}', '{"a":2}')).toBe(false);
    expect(estaCalculando(null, null)).toBe(false);
  });
});
