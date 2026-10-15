import { describe, expect, it } from "vitest";
import {
  azarConSemilla,
  calcularPlanoDeCorte,
  type PiezaAcortar,
  type PiezaColocada,
  type PlanoDeCorte,
} from "@/lib/cortes/plano";
import {
  armarHojaDeCorte,
  MEDIDAS_POR_TANDA,
  PatronNoGuillotina,
  type HojaDeCorte,
  type Trozo,
} from "@/lib/cortes/secuencia";

/**
 * La hoja de corte para la seccionadora.
 *
 * Lo que importa no es que se vea linda sino que **se pueda cortar tal cual**:
 * que salgan todas las piezas del despiece y ninguna de más, que cada medida
 * más la sierra sume lo que mide el trozo, que cada corte vaya de borde a borde
 * del trozo que parte y no pase por una pieza, y que las tandas no pasen de
 * cuatro medidas. Una hoja que no cumple eso manda a cortar mal una placa.
 */

const PLACA = { placaLargo: 2750, placaAncho: 1830 };
const EPS = 0.01;

function pieza(p: Partial<PiezaAcortar>): PiezaAcortar {
  return { largoMm: 600, anchoMm: 400, cantidad: 1, respetaVeta: 0, ...p };
}

/** Cuántas piezas de cada renglón salen de la hoja, contando todo. */
function piezasDeLaHoja(hoja: HojaDeCorte): Map<number, number> {
  const cuenta = new Map<number, number>();
  for (const patron of hoja.patrones) {
    for (const op of patron.operaciones) {
      for (const paso of op.pasos) {
        for (const s of paso.sale) {
          if (s.tipo !== "pieza") continue;
          const total = s.cantidad * patron.placas.length;
          cuenta.set(s.renglon!, (cuenta.get(s.renglon!) ?? 0) + total);
        }
      }
    }
    // Una placa que es una sola pieza no tiene operaciones.
    if (patron.operaciones.length === 0 && patron.arbol.tipo === "pieza") {
      const r = patron.arbol.pieza.indice + 1;
      cuenta.set(r, (cuenta.get(r) ?? 0) + patron.placas.length);
    }
  }
  return cuenta;
}

/** Lo que pide el despiece, menos lo que no entra. */
function piezasDelPlano(plano: PlanoDeCorte): Map<number, number> {
  const cuenta = new Map<number, number>();
  for (const placa of plano.placas) {
    for (const p of placa.piezas) {
      cuenta.set(p.indice + 1, (cuenta.get(p.indice + 1) ?? 0) + 1);
    }
  }
  return cuenta;
}

/**
 * Recorre el árbol y comprueba que es físicamente cortable.
 *
 * Cada trozo partido: sus tiras van una detrás de otra desde el borde, con la
 * sierra entre medio, y la suma de medidas más sierra más lo que queda da lo
 * que mide el trozo. Cada tira atraviesa el trozo de borde a borde en el otro
 * eje. Y las piezas son rectángulos que no se pisan y no salen de la placa.
 */
function verificarArbol(trozo: Trozo, sierra: number) {
  if (trozo.tipo !== "partido") return;
  const eje = trozo.eje;
  const inicio = eje === "y" ? trozo.rect.y : trozo.rect.x;
  const total = eje === "y" ? trozo.rect.alto : trozo.rect.ancho;
  let cursor = inicio;

  trozo.hijos.forEach((h) => {
    const desde = eje === "y" ? h.rect.y : h.rect.x;
    const medida = eje === "y" ? h.rect.alto : h.rect.ancho;
    expect(Math.abs(desde - cursor)).toBeLessThan(EPS);
    // De borde a borde del trozo en el otro eje: es lo que hace la guillotina.
    if (eje === "y") {
      expect(h.rect.x).toBeCloseTo(trozo.rect.x, 3);
      expect(h.rect.ancho).toBeCloseTo(trozo.rect.ancho, 3);
    } else {
      expect(h.rect.y).toBeCloseTo(trozo.rect.y, 3);
      expect(h.rect.alto).toBeCloseTo(trozo.rect.alto, 3);
    }
    cursor += medida + sierra;
    verificarArbol(h, sierra);
  });

  const usado = cursor - sierra - inicio;
  if (trozo.ultimaSinCorte) {
    expect(Math.abs(usado - total)).toBeLessThan(EPS);
    expect(trozo.sobra).toBeNull();
  } else {
    expect(usado).toBeLessThan(total + EPS);
    const sobra = trozo.sobra ? (eje === "y" ? trozo.sobra.alto : trozo.sobra.ancho) : 0;
    // Lo que queda más el último corte cierra la cuenta, salvo que lo que
    // quedaba fuera más fino que la sierra y se lo haya comido el disco.
    if (trozo.sobra) expect(usado + sierra + sobra).toBeCloseTo(total, 2);
    else expect(total - usado).toBeLessThanOrEqual(sierra + EPS);
  }
}

function piezasDelArbol(t: Trozo): PiezaColocada[] {
  if (t.tipo === "pieza") return [t.pieza];
  if (t.tipo === "sobrante") return [];
  return t.hijos.flatMap(piezasDelArbol);
}

function verificarHoja(plano: PlanoDeCorte, hoja: HojaDeCorte) {
  // Ni una de más ni una de menos, renglón por renglón.
  expect(piezasDeLaHoja(hoja)).toEqual(piezasDelPlano(plano));
  expect(hoja.patrones.reduce((t, p) => t + p.placas.length, 0)).toBe(plano.placas.length);

  for (const patron of hoja.patrones) {
    verificarArbol(patron.arbol, plano.anchoSierra);

    const piezas = piezasDelArbol(patron.arbol);
    expect(piezas.length).toBe(patron.piezasPorPlaca);
    for (const p of piezas) {
      expect(p.x).toBeGreaterThanOrEqual(-EPS);
      expect(p.y).toBeGreaterThanOrEqual(-EPS);
      expect(p.x + p.ancho).toBeLessThanOrEqual(plano.placaLargo + EPS);
      expect(p.y + p.alto).toBeLessThanOrEqual(plano.placaAncho + EPS);
    }
    for (let i = 0; i < piezas.length; i++) {
      for (let j = i + 1; j < piezas.length; j++) {
        const a = piezas[i]!;
        const b = piezas[j]!;
        const sePisan =
          a.x < b.x + b.ancho - EPS &&
          b.x < a.x + a.ancho - EPS &&
          a.y < b.y + b.alto - EPS &&
          b.y < a.y + a.alto - EPS;
        expect(sePisan).toBe(false);
      }
    }

    // Ningún corte dibujado pasa por adentro de una pieza.
    for (const c of patron.dibujo.cortes) {
      for (const p of piezas) {
        if (c.y1 === c.y2) {
          const cruza =
            c.y1 > p.y + EPS && c.y1 < p.y + p.alto - EPS && c.x1 < p.x + p.ancho - EPS && c.x2 > p.x + EPS;
          expect(cruza).toBe(false);
        } else {
          const cruza =
            c.x1 > p.x + EPS && c.x1 < p.x + p.ancho - EPS && c.y1 < p.y + p.alto - EPS && c.y2 > p.y + EPS;
          expect(cruza).toBe(false);
        }
      }
      expect(c.paso).toBeGreaterThan(0);
    }

    // Tantos cortes dibujados como pasadas dice la lista.
    expect(patron.dibujo.cortes.length).toBe(patron.pasadasPorPlaca);

    for (const op of patron.operaciones) {
      for (const tanda of op.tandas) {
        expect(tanda.length).toBeGreaterThan(0);
        expect(tanda.length).toBeLessThanOrEqual(MEDIDAS_POR_TANDA);
      }
      expect(op.tandas.flat()).toEqual(op.pasos);
      // Cada trozo que sigue dice en qué operación se sigue.
      for (const paso of op.pasos) {
        for (const s of paso.sale) {
          if (s.tipo === "trozo") {
            const sigue = patron.operaciones.find((o) => o.numero === s.sigueEn);
            expect(sigue?.delPaso).toBe(paso.numero);
            expect(sigue?.nivel).toBeGreaterThan(op.nivel);
            // Con la misma letra, para no confundir dos tiras de igual medida.
            expect(sigue?.letra).toBe(s.letra);
          }
        }
        const trozos = paso.sale.filter((s) => s.tipo === "trozo");
        if (trozos.length > 1) {
          expect(new Set(trozos.map((s) => s.letra)).size).toBe(trozos.length);
        }
      }
    }

    // El orden es el de la seccionadora: nunca un nivel antes que el anterior.
    const niveles = patron.operaciones.map((o) => o.nivel);
    expect([...niveles].sort((a, b) => a - b)).toEqual(niveles);
  }
}

describe("una pieza sola", () => {
  const plano = calcularPlanoDeCorte({ piezas: [pieza({ respetaVeta: 1 })], ...PLACA, anchoSierra: 5 });
  const hoja = armarHojaDeCorte(plano);

  it("primero la tira a lo largo, después la pieza de través", () => {
    verificarHoja(plano, hoja);
    const [primera, segunda] = hoja.patrones[0]!.operaciones;
    expect(primera!.direccion).toBe("longitudinal");
    expect(primera!.nivel).toBe(1);
    expect(primera!.pasos).toHaveLength(1);
    expect(primera!.pasos[0]!.medida).toBe(400);
    expect(primera!.pasos[0]!.sale[0]).toMatchObject({ tipo: "trozo", largo: 2750, ancho: 400 });
    // 1830 − 400 − 5 de sierra: el resto de la placa, al stock.
    expect(primera!.sobra).toEqual({ largo: 2750, ancho: 1425, tipo: "retal" });

    expect(segunda!.direccion).toBe("transversal");
    expect(segunda!.delPaso).toBe(1);
    expect(segunda!.pasos[0]).toMatchObject({ medida: 600, veces: 1 });
    expect(segunda!.pasos[0]!.sale[0]).toMatchObject({ tipo: "pieza", renglon: 1, cantidad: 1 });
    expect(segunda!.sobra).toEqual({ largo: 2145, ancho: 400, tipo: "retal" });
  });
});

describe("tiras iguales", () => {
  // Cinco zócalos del largo de la placa: cada tira ya es la pieza.
  const plano = calcularPlanoDeCorte({
    piezas: [pieza({ largoMm: 2750, anchoMm: 300, cantidad: 5, respetaVeta: 1 })],
    ...PLACA,
    anchoSierra: 5,
  });
  const hoja = armarHojaDeCorte(plano);

  it("es una sola medida tipeada cinco veces, sin segundo nivel", () => {
    verificarHoja(plano, hoja);
    const ops = hoja.patrones[0]!.operaciones;
    expect(ops).toHaveLength(1);
    expect(ops[0]!.pasos).toEqual([
      expect.objectContaining({
        medida: 300,
        veces: 5,
        ultimaSinCorte: false,
        sale: [expect.objectContaining({ tipo: "pieza", cantidad: 5, renglon: 1 })],
      }),
    ]);
    // 1830 − 5 × 300 − 5 × 5.
    expect(ops[0]!.sobra).toEqual({ largo: 2750, ancho: 305, tipo: "retal" });
    expect(hoja.patrones[0]!.pasadasPorPlaca).toBe(5);
  });

  it("si la última tira llega justo al borde, no lleva corte", () => {
    // 605 + 5 + 610 + 5 + 605 = 1830: la tercera es lo que queda.
    const justo = calcularPlanoDeCorte({
      piezas: [
        pieza({ largoMm: 2750, anchoMm: 610, cantidad: 1, respetaVeta: 1 }),
        pieza({ largoMm: 2750, anchoMm: 605, cantidad: 2, respetaVeta: 1 }),
      ],
      ...PLACA,
      anchoSierra: 5,
    });
    const h = armarHojaDeCorte(justo);
    verificarHoja(justo, h);
    const op = h.patrones[0]!.operaciones[0]!;
    const ultimo = op.pasos.at(-1)!;
    expect(ultimo.ultimaSinCorte).toBe(true);
    expect(op.sobra).toBeNull();
    expect(h.patrones[0]!.pasadasPorPlaca).toBe(2);
  });
});

describe("tercer nivel", () => {
  // A mano, para saber exactamente qué tiene que salir: una tira de 795 de la
  // que salen dos trozos de 600 de largo. Uno es una pieza de 600 × 795; el
  // otro trae dos piezas de 600 × 395 que se separan a lo largo, en el nivel 3.
  const sierra = 5;
  const colocada = (x: number, y: number, alto: number, indice: number, unidad: number): PiezaColocada => ({
    x, y, ancho: 600, alto, indice, unidad, girada: false, largoOriginal: 600, anchoOriginal: alto,
  });
  const colocadas = [
    colocada(0, 0, 395, 0, 1),
    colocada(0, 400, 395, 0, 2),
    colocada(605, 0, 795, 1, 1),
  ];
  const plano: PlanoDeCorte = {
    ...PLACA,
    anchoSierra: sierra,
    placas: [{ numero: 1, piezas: colocadas, cortes: [], recortes: [], aprovechado: 0.19, seVendeEntera: false }],
    noEntran: [],
    totalPiezas: 3,
    aprovechadoTotal: 0.19,
    pasadas: 0,
    recorteMayor: null,
    placasEnteras: 0,
    pasadasCobrables: 0,
    fijadasDescartadas: [],
  };
  const hoja = armarHojaDeCorte(plano);

  it("tira, trozos de través, y piezas a lo largo de nuevo", () => {
    verificarHoja(plano, hoja);
    const ops = hoja.patrones[0]!.operaciones;
    expect(ops.map((o) => [o.nivel, o.direccion])).toEqual([
      [1, "longitudinal"],
      [2, "transversal"],
      [3, "longitudinal"],
    ]);
    // La tira: lo que ocupa la pieza más alta, 795.
    expect(ops[0]!.pasos[0]).toMatchObject({ medida: 795, veces: 1 });
    // Dos trozos de 600: la medida se tipea una vez, ×2, y sale de todo.
    expect(ops[1]!.pasos[0]).toMatchObject({ medida: 600, veces: 2 });
    expect(ops[1]!.pasos[0]!.sale).toEqual([
      expect.objectContaining({ tipo: "trozo", largo: 600, ancho: 795, sigueEn: 3 }),
      expect.objectContaining({ tipo: "pieza", renglon: 2, largo: 600, ancho: 795 }),
    ]);
    // 395 + 5 + 395 = 795: la segunda es lo que queda, sin corte.
    expect(ops[2]!.delPaso).toBe(2);
    expect(ops[2]!.pasos[0]).toMatchObject({ medida: 395, veces: 2, ultimaSinCorte: true });
    expect(ops[2]!.sobra).toBeNull();
  });
});

describe("placas repetidas", () => {
  // Cuatro de 1300 × 900 entran por placa: ocho son dos placas iguales.
  const plano = calcularPlanoDeCorte({
    piezas: [pieza({ largoMm: 1300, anchoMm: 900, cantidad: 8, respetaVeta: 1 })],
    ...PLACA,
    anchoSierra: 5,
  });
  const hoja = armarHojaDeCorte(plano);

  it("van como un solo patrón ×2 placas", () => {
    expect(plano.placas).toHaveLength(2);
    verificarHoja(plano, hoja);
    expect(hoja.patrones).toHaveLength(1);
    expect(hoja.patrones[0]!.placas).toEqual([1, 2]);
    // Dos tiras de 900 iguales: su corte transversal se lee una vez, ×2.
    const [tiras, trozos] = hoja.patrones[0]!.operaciones;
    expect(tiras!.pasos[0]).toMatchObject({ medida: 900, veces: 2 });
    expect(trozos!.repeticiones).toBe(2);
    expect(trozos!.pasos[0]).toMatchObject({ medida: 1300, veces: 2 });
    expect(trozos!.pasos[0]!.sale[0]).toMatchObject({ tipo: "pieza", cantidad: 4 });
  });
});

describe("pieza girada", () => {
  it("dice que va girada y da la medida como queda sobre la placa", () => {
    // 1830 de largo no entra a lo largo de la tira de 300 sin girarla: sobre
    // la placa queda de 300 de largo × 1830 de ancho.
    const plano = calcularPlanoDeCorte({
      piezas: [pieza({ largoMm: 1830, anchoMm: 300, cantidad: 3, etiqueta: "Lateral" })],
      placaLargo: 1000,
      placaAncho: 1830,
      anchoSierra: 5,
      busqueda: false,
    });
    const hoja = armarHojaDeCorte(plano);
    verificarHoja(plano, hoja);
    const salidas = hoja.patrones[0]!.operaciones.flatMap((o) => o.pasos.flatMap((p) => p.sale));
    const piezas = salidas.filter((s) => s.tipo === "pieza");
    expect(piezas.every((s) => s.girada)).toBe(true);
    expect(piezas[0]).toMatchObject({ largo: 300, ancho: 1830, etiqueta: "Lateral", renglon: 1 });
    // Sin cortes a lo largo posibles: arranca de través, en el nivel 2.
    expect(hoja.patrones[0]!.operaciones[0]!.direccion).toBe("transversal");
  });
});

describe("sobrantes", () => {
  it("retal si da para guardar, desperdicio si no", () => {
    const plano = calcularPlanoDeCorte({
      // 1830 − 1700 − 5 = 125: no llega a 150, es desperdicio.
      piezas: [pieza({ largoMm: 2750, anchoMm: 1700, respetaVeta: 1 })],
      ...PLACA,
      anchoSierra: 5,
    });
    const hoja = armarHojaDeCorte(plano);
    verificarHoja(plano, hoja);
    expect(hoja.patrones[0]!.operaciones[0]!.sobra).toEqual({
      largo: 2750,
      ancho: 125,
      tipo: "desperdicio",
    });
    expect(hoja.patrones[0]!.dibujo.sobrantes).toEqual([
      { rect: { x: 0, y: 1705, ancho: 2750, alto: 125 }, tipo: "desperdicio" },
    ]);
  });

  it("un hueco entre tiras se corre al final y queda en un solo pedazo", () => {
    // Dos tiras con 200 mm de aire entre medio: en la máquina van juntas.
    const sierra = 5;
    const p = (y: number, i: number): PiezaColocada => ({
      x: 0, y, ancho: 2750, alto: 500, indice: 0, unidad: i, girada: false, largoOriginal: 2750, anchoOriginal: 500,
    });
    const plano: PlanoDeCorte = {
      ...PLACA,
      anchoSierra: sierra,
      placas: [{ numero: 1, piezas: [p(0, 1), p(705, 2)], cortes: [], recortes: [], aprovechado: 0.5, seVendeEntera: false }],
      noEntran: [], totalPiezas: 2, aprovechadoTotal: 0.5, pasadas: 0, recorteMayor: null,
      placasEnteras: 0, pasadasCobrables: 0, fijadasDescartadas: [],
    };
    const hoja = armarHojaDeCorte(plano);
    verificarHoja(plano, hoja);
    const op = hoja.patrones[0]!.operaciones[0]!;
    expect(op.pasos[0]).toMatchObject({ medida: 500, veces: 2 });
    // 1830 − 500 − 5 − 500 − 5 = 820, de una sola pieza.
    expect(op.sobra).toEqual({ largo: 2750, ancho: 820, tipo: "retal" });
  });
});

describe("con sierra de 4,4 mm", () => {
  const piezas = [
    pieza({ largoMm: 1200, anchoMm: 350, cantidad: 4 }),
    pieza({ largoMm: 800, anchoMm: 600, cantidad: 6, etiqueta: "Puerta" }),
    pieza({ largoMm: 600, anchoMm: 400, cantidad: 4, respetaVeta: 1 }),
    pieza({ largoMm: 300, anchoMm: 250, cantidad: 10 }),
  ];
  const plano = calcularPlanoDeCorte({ piezas, ...PLACA, anchoSierra: 4.4 });
  const hoja = armarHojaDeCorte(plano);

  it("salen todas las piezas y las cuentas cierran con decimales", () => {
    verificarHoja(plano, hoja);
    expect([...piezasDeLaHoja(hoja).entries()].sort()).toEqual([
      [1, 4],
      [2, 6],
      [3, 4],
      [4, 10],
    ]);
    // Ninguna medida con ruido de punto flotante.
    for (const op of hoja.patrones.flatMap((p) => p.operaciones)) {
      for (const paso of op.pasos) {
        expect(Math.round(paso.medida * 1000) / 1000).toBe(paso.medida);
      }
      if (op.sobra) expect(Math.round(op.sobra.ancho * 1000) / 1000).toBe(op.sobra.ancho);
    }
  });
});

describe("despieces al azar", () => {
  /*
   * Doscientos despieces como los del mostrador, con la búsqueda prendida y
   * sierras distintas. Lo que se mide es que la hoja salga siempre y sea
   * cortable: un patrón que la secuencia no sabe partir sería un trabajo que
   * el taller no puede hacer con esta hoja.
   */
  it("la hoja sale siempre y es cortable", () => {
    const azar = azarConSemilla(1410);
    const sierras = [3.2, 4.4, 5];
    for (let caso = 0; caso < 200; caso++) {
      const cuantas = 1 + Math.floor(azar() * 7);
      const piezas: PiezaAcortar[] = [];
      for (let i = 0; i < cuantas; i++) {
        piezas.push(
          pieza({
            largoMm: 100 + Math.floor(azar() * 2000),
            anchoMm: 60 + Math.floor(azar() * 900),
            cantidad: 1 + Math.floor(azar() * 6),
            respetaVeta: azar() < 0.3 ? 1 : 0,
            etiqueta: azar() < 0.2 ? `Pieza ${i}` : null,
          }),
        );
      }
      const plano = calcularPlanoDeCorte({
        piezas,
        ...PLACA,
        anchoSierra: sierras[caso % sierras.length]!,
        presupuesto: 5_000,
      });
      verificarHoja(plano, armarHojaDeCorte(plano));
    }
  });
});

describe("lo que no se puede cortar", () => {
  it("sin piezas, la hoja sale vacía", () => {
    const plano = calcularPlanoDeCorte({ piezas: [], ...PLACA });
    const hoja = armarHojaDeCorte(plano);
    expect(hoja.patrones).toEqual([]);
    expect(hoja.totalPiezas).toBe(0);
  });

  it("las piezas que no entran quedan avisadas, no cortadas", () => {
    const plano = calcularPlanoDeCorte({
      piezas: [pieza({ largoMm: 3000, anchoMm: 400, respetaVeta: 1 }), pieza({})],
      ...PLACA,
    });
    const hoja = armarHojaDeCorte(plano);
    expect(hoja.noEntran).toHaveLength(1);
    verificarHoja(plano, hoja);
  });

  it("un molinete no es guillotina y se dice en vez de inventar una secuencia", () => {
    // Cuatro piezas en molinete alrededor de un hueco: no hay ningún corte de
    // borde a borde. El motor nunca arma esto, pero si llegara, mejor un error.
    const p = (x: number, y: number, ancho: number, alto: number, i: number): PiezaColocada => ({
      x, y, ancho, alto, indice: i, unidad: 1, girada: false, largoOriginal: ancho, anchoOriginal: alto,
    });
    const plano: PlanoDeCorte = {
      placaLargo: 1000,
      placaAncho: 1000,
      anchoSierra: 5,
      placas: [
        {
          numero: 1,
          piezas: [p(0, 0, 600, 395, 0), p(605, 0, 395, 600, 1), p(400, 605, 600, 395, 2), p(0, 400, 395, 600, 3)],
          cortes: [], recortes: [], aprovechado: 0.9, seVendeEntera: true,
        },
      ],
      noEntran: [], totalPiezas: 4, aprovechadoTotal: 0.9, pasadas: 0, recorteMayor: null,
      placasEnteras: 1, pasadasCobrables: 0, fijadasDescartadas: [],
    };
    expect(() => armarHojaDeCorte(plano)).toThrow(PatronNoGuillotina);
  });
});
