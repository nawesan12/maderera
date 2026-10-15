import { describe, expect, it } from "vitest";
import {
  azarConSemilla,
  calcularPlanoDeCorte,
  type PiezaAcortar,
} from "@/lib/cortes/plano";
import { armarHojaDeCorte } from "@/lib/cortes/secuencia";
import {
  armarPtx,
  espesorDelMaterial,
  leerPtx,
  nombreDeArchivoPtx,
  textoPtx,
  type RegistroPtx,
  type TrabajoParaPtx,
} from "@/lib/cortes/ptx";

/**
 * El programa PTX para la seccionadora.
 *
 * No hay una máquina contra la cual probarlo, así que se prueba lo que sí se
 * puede: que el archivo respete la especificación —registros, cantidad de
 * campos, índices, unidades—, que se pueda leer en una PC con Windows XP
 * —ASCII, CRLF, nombre 8.3— y, lo más importante, que **los cortes
 * reconstruyan las piezas**: leyendo solo el archivo, cada tira suma con la
 * sierra lo que mide su trozo, y salen exactamente las piezas del despiece.
 */

/** Campos que lleva cada registro, sin contar el nombre (PTX 1.14). */
const CAMPOS: Record<string, number> = {
  HEADER: 5,
  JOBS: 11,
  PARTS_REQ: 14,
  BOARDS: 16,
  MATERIALS: 23,
  PATTERNS: 10,
  CUTS: 9,
};

function trabajo(piezas: PiezaAcortar[], extra: Partial<TrabajoParaPtx> = {}): TrabajoParaPtx {
  return {
    numero: "CRT-460",
    cliente: "Carpintería Muñoz, hijos",
    material: "Melamina 18mm Blanco Ártico",
    createdAt: new Date(2026, 9, 14),
    piezas,
    ...extra,
  };
}

const num = (s: string) => Number(s);

interface Region {
  /** Lo que mide en el eje que parten sus hijos, y en el otro. */
  enEje: number;
  otro: number;
  funcion: number;
  hijos: { funcion: number; dimension: number; repeticiones: number; pieza: string; cantidad: number }[];
  /** Las regiones que abren los hijos que se siguen cortando. */
  sub: Region[];
}

/**
 * Vuelve a armar el árbol de un patrón leyendo solo los registros CUTS.
 *
 * Un registro de función f es hijo del último registro abierto de función
 * f − 1 (o de la placa, si f es 1). Los desperdicios (9x) cierran su fase.
 */
function reconstruir(
  cortes: RegistroPtx[],
  placaLargo: number,
  placaAncho: number,
  tipo: number,
): Region {
  // Tipo 0: los cortes de la función 1 se miden contra el ancho (tiras a lo
  // largo). Tipo 1: la placa se gira y se miden contra el largo.
  const raiz: Region = {
    enEje: tipo === 1 ? placaLargo : placaAncho,
    otro: tipo === 1 ? placaAncho : placaLargo,
    funcion: 1,
    hijos: [],
    sub: [],
  };
  const abiertas: Region[] = [raiz];

  for (const c of cortes) {
    const funcion = num(c.campos[4]!);
    const dimension = num(c.campos[5]!);
    const repeticiones = num(c.campos[6]!);
    const pieza = c.campos[7]!;
    const cantidad = num(c.campos[8]!);
    const fase = funcion >= 90 ? funcion - 90 : funcion;

    // La región que corta esta fase es la última abierta de esa función.
    while (abiertas.length > fase) abiertas.pop();
    const padre = abiertas[fase - 1]!;
    expect(padre.funcion).toBe(fase);
    padre.hijos.push({ funcion, dimension, repeticiones, pieza, cantidad });

    if (funcion < 90 && pieza === "0") {
      // Una tira que se sigue cortando abre una región de la fase siguiente.
      const region: Region = { enEje: padre.otro, otro: dimension, funcion: fase + 1, hijos: [], sub: [] };
      padre.sub.push(region);
      abiertas.push(region);
    }
  }
  return raiz;
}

/** Recorre la reconstrucción: cada región cierra su cuenta y junta piezas. */
function verificarRegion(
  region: Region,
  sierra: number,
  piezas: Map<string, { largo: number; ancho: number; veta: boolean }>,
  producidas: Map<string, number>,
  corrida: number,
) {
  // Σ medida × max(rep, 1) + sierra × Σ rep = lo que mide la región.
  const suma = region.hijos.reduce(
    (t, h) => t + h.dimension * Math.max(h.repeticiones, 1) + sierra * h.repeticiones,
    0,
  );
  expect(suma).toBeCloseTo(region.enEje, 1);

  for (const h of region.hijos) {
    if (h.funcion >= 90 || h.pieza === "0") continue;
    const pedida = piezas.get(h.pieza)!;
    expect(pedida).toBeDefined();
    // La pieza que sale mide la tira por lo que mide la región en el otro eje.
    const sale = [h.dimension, region.otro].sort((a, b) => a - b);
    const pide = [pedida.largo, pedida.ancho].sort((a, b) => a - b);
    expect(sale[0]).toBeCloseTo(pide[0]!, 3);
    expect(sale[1]).toBeCloseTo(pide[1]!, 3);
    expect(h.cantidad).toBe(Math.max(h.repeticiones, 1) * corrida);
    producidas.set(h.pieza, (producidas.get(h.pieza) ?? 0) + h.cantidad);
  }
  for (const sub of region.sub) verificarRegion(sub, sierra, piezas, producidas, corrida);
}

function verificarPtx(datos: TrabajoParaPtx, placaLargo: number, placaAncho: number, sierra: number) {
  const plano = calcularPlanoDeCorte({ piezas: datos.piezas, placaLargo, placaAncho, anchoSierra: sierra });
  const hoja = armarHojaDeCorte(plano);
  const texto = armarPtx(datos, hoja);

  // Para Windows XP: solo ASCII y cada línea con CRLF.
  expect(/^[\x20-\x7E\r\n]*$/.test(texto)).toBe(true);
  expect(texto.endsWith("\r\n")).toBe(true);
  expect(texto.replace(/\r\n/g, "").includes("\n")).toBe(false);

  const registros = leerPtx(texto);
  for (const r of registros) {
    expect(CAMPOS[r.tipo], `registro desconocido ${r.tipo}`).toBeDefined();
    expect(r.campos.length, r.tipo).toBe(CAMPOS[r.tipo]);
  }

  const de = (tipo: string) => registros.filter((r) => r.tipo === tipo);
  expect(de("HEADER")).toHaveLength(1);
  expect(de("HEADER")[0]!.campos[2]).toBe("0"); // milímetros
  expect(de("HEADER")[0]!.campos[1]!.length).toBeLessThanOrEqual(25);
  expect(de("MATERIALS")[0]!.campos[6]).toBe(sierra.toFixed(1));
  expect(de("MATERIALS")[0]!.campos[7]).toBe(sierra.toFixed(1));
  // Los códigos de material no llevan espacios.
  expect(de("MATERIALS")[0]!.campos[2]).not.toContain(" ");

  const partes = de("PARTS_REQ");
  expect(partes.map((p) => num(p.campos[1]!))).toEqual(datos.piezas.map((_, i) => i + 1));
  const piezas = new Map(
    partes.map((p) => [
      p.campos[1]!,
      { largo: num(p.campos[4]!), ancho: num(p.campos[5]!), veta: p.campos[9] === "1" },
    ]),
  );

  const patrones = de("PATTERNS");
  expect(patrones.map((p) => num(p.campos[1]!))).toEqual(patrones.map((_, i) => i + 1));
  expect(patrones.reduce((t, p) => t + num(p.campos[4]!), 0)).toBe(plano.placas.length);

  const producidas = new Map<string, number>();
  const cuts = de("CUTS");
  for (const patron of patrones) {
    const ptn = patron.campos[1]!;
    const corrida = num(patron.campos[4]!);
    const propios = cuts.filter((c) => c.campos[1] === ptn);
    // CUT_INDEX arranca en 1 por patrón y no salta.
    expect(propios.map((c) => num(c.campos[2]!))).toEqual(propios.map((_, i) => i + 1));
    // SEQUENCE: cada pasada con su número, sin repetir, avanzando por QTY_RPT.
    const secuencias = propios
      .filter((c) => num(c.campos[6]!) > 0)
      .map((c) => ({ desde: num(c.campos[3]!), rep: num(c.campos[6]!) }))
      .sort((a, b) => a.desde - b.desde);
    let siguiente = 1;
    for (const s of secuencias) {
      expect(s.desde).toBe(siguiente);
      siguiente += s.rep;
    }

    const raiz = reconstruir(propios, placaLargo, placaAncho, num(patron.campos[3]!));
    verificarRegion(raiz, sierra, piezas, producidas, corrida);
  }

  // Salen exactamente las piezas del plano, y QTY_PROD lo dice.
  for (const p of partes) {
    const renglon = num(p.campos[1]!);
    const enElPlano = plano.placas.reduce(
      (t, placa) => t + placa.piezas.filter((x) => x.indice + 1 === renglon).length,
      0,
    );
    expect(producidas.get(p.campos[1]!) ?? 0).toBe(enElPlano);
    expect(num(p.campos[10]!)).toBe(enElPlano);
  }

  return { texto, registros, plano, hoja };
}

describe("el archivo", () => {
  it("de un despiece de tres piezas", () => {
    const { texto, registros } = verificarPtx(
      trabajo([
        { largoMm: 800, anchoMm: 400, cantidad: 2, respetaVeta: 1, etiqueta: "Puerta" },
        { largoMm: 600, anchoMm: 350, cantidad: 1, respetaVeta: 0 },
      ]),
      2750,
      1830,
      4.4,
    );
    expect(registros.map((r) => r.tipo).slice(0, 6)).toEqual([
      "HEADER",
      "JOBS",
      "PARTS_REQ",
      "PARTS_REQ",
      "BOARDS",
      "MATERIALS",
    ]);
    expect(texto.startsWith("HEADER,1.14,MJBJ CRT-460,0,0,1\r\n")).toBe(true);
    // Sin acentos ni comas en los textos: «Muñoz, hijos» → «Munoz. hijos».
    expect(texto).toContain("Carpinteria Munoz. hijos");
    expect(texto).toContain("PARTS_REQ,1,1,P1_PUERTA,1,800.0,400.0,2,0,0,1,2,0,0,0");
    expect(texto).toContain("MATERIALS,1,1,MELAMINA_18MM_BLANCO_ARTICO,Melamina 18mm Blanco Artico,18.0,1,4.4,4.4,");
  });

  it("con placas repetidas va un solo patrón con QTY_RUN", () => {
    const { registros } = verificarPtx(
      trabajo([{ largoMm: 1300, anchoMm: 900, cantidad: 8, respetaVeta: 1 }]),
      2750,
      1830,
      5,
    );
    const patrones = registros.filter((r) => r.tipo === "PATTERNS");
    expect(patrones).toHaveLength(1);
    expect(patrones[0]!.campos[4]).toBe("2");
  });

  it("con encaje exacto, la última tira va sin corte", () => {
    const { registros } = verificarPtx(
      trabajo([
        { largoMm: 2750, anchoMm: 610, cantidad: 1, respetaVeta: 1 },
        { largoMm: 2750, anchoMm: 605, cantidad: 2, respetaVeta: 1 },
      ]),
      2750,
      1830,
      5,
    );
    const cuts = registros.filter((r) => r.tipo === "CUTS");
    // Ni un desperdicio de fase 1: no sobra nada.
    expect(cuts.some((c) => c.campos[4] === "91")).toBe(false);
    expect(cuts.at(-1)!.campos[6]).toBe("0");
  });

  it("si arranca de través, gira la placa (TYPE 1)", () => {
    const { registros } = verificarPtx(
      trabajo([{ largoMm: 1830, anchoMm: 300, cantidad: 3, respetaVeta: 0 }]),
      1000,
      1830,
      5,
    );
    expect(registros.find((r) => r.tipo === "PATTERNS")!.campos[3]).toBe("1");
  });

  it("deja afuera lo que no entra y lo dice en QTY_PROD", () => {
    const { registros } = verificarPtx(
      trabajo([
        { largoMm: 3000, anchoMm: 400, cantidad: 1, respetaVeta: 1 },
        { largoMm: 600, anchoMm: 400, cantidad: 1, respetaVeta: 0 },
      ]),
      2750,
      1830,
      5,
    );
    const primera = registros.find((r) => r.tipo === "PARTS_REQ")!;
    expect(primera.campos[6]).toBe("1"); // pedida
    expect(primera.campos[10]).toBe("0"); // producida
  });

  it("doscientos despieces al azar se reconstruyen desde el archivo", () => {
    const azar = azarConSemilla(2026);
    for (let caso = 0; caso < 200; caso++) {
      const piezas: PiezaAcortar[] = [];
      const cuantas = 1 + Math.floor(azar() * 6);
      for (let i = 0; i < cuantas; i++) {
        piezas.push({
          largoMm: 100 + Math.floor(azar() * 2000),
          anchoMm: 60 + Math.floor(azar() * 900),
          cantidad: 1 + Math.floor(azar() * 6),
          respetaVeta: azar() < 0.3 ? 1 : 0,
        });
      }
      verificarPtx(trabajo(piezas), 2750, 1830, [3.2, 4.4, 5][caso % 3]!);
    }
  });
});

describe("para Windows XP", () => {
  it("el nombre es 8.3 y en mayúsculas", () => {
    expect(nombreDeArchivoPtx("CRT-460")).toBe("CRT460.PTX");
    expect(nombreDeArchivoPtx("CRT-1234567")).toBe("CRT34567.PTX");
    for (const n of ["CRT-1", "CRT-99999", "X-123456789"]) {
      expect(nombreDeArchivoPtx(n)).toMatch(/^[A-Z0-9]{1,8}\.PTX$/);
    }
  });

  it("los textos quedan en ASCII, sin comas ni comillas", () => {
    expect(textoPtx('Melamina 18mm, "blanca" ñandú × 2')).toBe("Melamina 18mm. blanca nandu x 2");
    expect(textoPtx("x".repeat(80), 25)).toHaveLength(25);
  });

  it("el espesor sale de la descripción", () => {
    expect(espesorDelMaterial("Melamina 18mm blanca")).toBe(18);
    expect(espesorDelMaterial("MDF 5,5 mm")).toBe(5.5);
    expect(espesorDelMaterial("Fenólico")).toBeNull();
  });
});

describe("la lectura", () => {
  it("acepta comillas, espacios iniciales y comas finales", () => {
    const [r] = leerPtx('CUTS,  1,   4,   2,   3,91,   5.2,    0,    0,    0,"un, comentario",\r\n');
    expect(r!.tipo).toBe("CUTS");
    expect(r!.campos.slice(0, 6)).toEqual(["1", "4", "2", "3", "91", "5.2"]);
    expect(r!.campos[9]).toBe("un, comentario");
  });
});
