import { describe, expect, it } from "vitest";
import {
  calcularPlanoDeCorte,
  superficieDeSierra,
  leerAcomodoManual,
  MINIMO_APROVECHABLE,
  type PiezaAcortar,
} from "@/lib/cortes/plano";

/**
 * El plano de corte.
 *
 * Lo que se prueba acá no es que el acomodo sea el mejor —no lo es, es una
 * heurística— sino que sea **ejecutable**: que ninguna pieza se pise con otra,
 * que ninguna se salga de la placa, que la sierra se cobre su espesor y que
 * una pieza con veta no aparezca girada. Un plano que no cumple eso manda a
 * cortar mal una placa de melamina, que son varios miles de pesos.
 */

const PLACA = { placaLargo: 2750, placaAncho: 1830 };

function pieza(p: Partial<PiezaAcortar>): PiezaAcortar {
  return {
    largoMm: 600,
    anchoMm: 400,
    cantidad: 1,
    respetaVeta: 0,
    ...p,
  };
}

/** ¿Se superponen dos rectángulos? */
function sePisan(
  a: { x: number; y: number; ancho: number; alto: number },
  b: { x: number; y: number; ancho: number; alto: number },
): boolean {
  return (
    a.x < b.x + b.ancho &&
    b.x < a.x + a.ancho &&
    a.y < b.y + b.alto &&
    b.y < a.y + a.alto
  );
}

describe("el plano es ejecutable", () => {
  const piezas = [
    pieza({ largoMm: 1200, anchoMm: 350, cantidad: 4 }),
    pieza({ largoMm: 800, anchoMm: 600, cantidad: 6 }),
    pieza({ largoMm: 600, anchoMm: 400, cantidad: 4, respetaVeta: 1 }),
    pieza({ largoMm: 300, anchoMm: 250, cantidad: 10 }),
  ];

  const plano = calcularPlanoDeCorte({ piezas, ...PLACA });

  it("coloca todas las piezas pedidas", () => {
    const pedidas = piezas.reduce((t, p) => t + p.cantidad, 0);
    const colocadas = plano.placas.reduce((t, p) => t + p.piezas.length, 0);
    expect(plano.noEntran).toEqual([]);
    expect(colocadas).toBe(pedidas);
    expect(plano.totalPiezas).toBe(pedidas);
  });

  it("ninguna pieza se sale de la placa", () => {
    for (const placa of plano.placas) {
      for (const p of placa.piezas) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.x + p.ancho).toBeLessThanOrEqual(PLACA.placaLargo);
        expect(p.y + p.alto).toBeLessThanOrEqual(PLACA.placaAncho);
      }
    }
  });

  it("ninguna pieza se pisa con otra", () => {
    for (const placa of plano.placas) {
      for (let i = 0; i < placa.piezas.length; i++) {
        for (let j = i + 1; j < placa.piezas.length; j++) {
          expect(sePisan(placa.piezas[i]!, placa.piezas[j]!)).toBe(false);
        }
      }
    }
  });

  it("deja el espesor de la sierra entre piezas vecinas", () => {
    // Dos piezas que comparten borde tienen que estar separadas al menos por el
    // ancho de sierra: si se tocan, la segunda sale corta.
    for (const placa of plano.placas) {
      for (let i = 0; i < placa.piezas.length; i++) {
        for (let j = i + 1; j < placa.piezas.length; j++) {
          const a = placa.piezas[i]!;
          const b = placa.piezas[j]!;
          const seSolapanEnY =
            a.y < b.y + b.alto && b.y < a.y + a.alto;
          const seSolapanEnX =
            a.x < b.x + b.ancho && b.x < a.x + a.ancho;

          if (seSolapanEnY) {
            const hueco =
              a.x < b.x ? b.x - (a.x + a.ancho) : a.x - (b.x + b.ancho);
            if (hueco >= 0) {
              expect(hueco).toBeGreaterThanOrEqual(plano.anchoSierra);
            }
          }
          if (seSolapanEnX) {
            const hueco =
              a.y < b.y ? b.y - (a.y + a.alto) : a.y - (b.y + b.alto);
            if (hueco >= 0) {
              expect(hueco).toBeGreaterThanOrEqual(plano.anchoSierra);
            }
          }
        }
      }
    }
  });

  it("cada corte cae dentro de la placa", () => {
    for (const placa of plano.placas) {
      for (const c of placa.cortes) {
        expect(c.x1).toBeGreaterThanOrEqual(0);
        expect(c.y1).toBeGreaterThanOrEqual(0);
        expect(c.x2).toBeLessThanOrEqual(PLACA.placaLargo);
        expect(c.y2).toBeLessThanOrEqual(PLACA.placaAncho);
      }
    }
  });

  it("ningún corte atraviesa una pieza", () => {
    // Es la garantía de que el plano se puede ejecutar: la sierra nunca pasa
    // por el medio de algo que hay que entregar entero.
    for (const placa of plano.placas) {
      for (const c of placa.cortes) {
        for (const p of placa.piezas) {
          if (c.direccion === "vertical") {
            const cruzaX = c.x1 > p.x && c.x1 < p.x + p.ancho;
            const cruzaY = c.y1 < p.y + p.alto && c.y2 > p.y;
            expect(cruzaX && cruzaY).toBe(false);
          } else {
            const cruzaY = c.y1 > p.y && c.y1 < p.y + p.alto;
            const cruzaX = c.x1 < p.x + p.ancho && c.x2 > p.x;
            expect(cruzaY && cruzaX).toBe(false);
          }
        }
      }
    }
  });

  it("informa un aprovechamiento creíble", () => {
    expect(plano.aprovechadoTotal).toBeGreaterThan(0);
    expect(plano.aprovechadoTotal).toBeLessThanOrEqual(1);
  });

  it("cuenta pasadas, que es de lo que sale el precio", () => {
    expect(plano.pasadas).toBeGreaterThan(0);
    expect(Number.isInteger(plano.pasadas)).toBe(true);
  });
});

describe("la veta manda", () => {
  it("una pieza que respeta la veta nunca sale girada", () => {
    const plano = calcularPlanoDeCorte({
      // Más alta que ancha: sin la veta, la heurística la giraría para bajar la
      // tira. Con veta tiene que quedarse como la pidió el cliente.
      piezas: [pieza({ largoMm: 400, anchoMm: 900, cantidad: 3, respetaVeta: 1 })],
      ...PLACA,
    });

    for (const placa of plano.placas) {
      for (const p of placa.piezas) {
        expect(p.girada).toBe(false);
        expect(p.ancho).toBe(400);
        expect(p.alto).toBe(900);
      }
    }
  });

  it("sin veta, se gira cuando es la única forma de que entre", () => {
    // 1800 × 2700 no entra derecha en una placa de 2750 × 1830 —2700 de alto
    // contra 1830— pero girada sí. Sin veta que lo impida, se gira.
    const plano = calcularPlanoDeCorte({
      piezas: [pieza({ largoMm: 1800, anchoMm: 2700, cantidad: 1 })],
      ...PLACA,
    });

    expect(plano.noEntran).toEqual([]);
    expect(plano.placas[0]!.piezas[0]!.girada).toBe(true);
    expect(plano.placas[0]!.piezas[0]!.ancho).toBe(2700);
    expect(plano.placas[0]!.piezas[0]!.alto).toBe(1800);
  });

  it("una pieza con veta que no entra derecha se avisa, no se gira a escondidas", () => {
    // 2000 de ancho contra una placa de 1830: girada entraría, pero la veta lo
    // prohíbe. Girarla igual sería entregar una pieza con la veta cruzada.
    const plano = calcularPlanoDeCorte({
      piezas: [pieza({ largoMm: 500, anchoMm: 2000, cantidad: 1, respetaVeta: 1 })],
      ...PLACA,
    });

    expect(plano.noEntran).toHaveLength(1);
    expect(plano.placas).toEqual([]);
  });
});

describe("cuando algo no entra", () => {
  it("una pieza más grande que la placa se avisa", () => {
    const plano = calcularPlanoDeCorte({
      piezas: [pieza({ largoMm: 3000, anchoMm: 2000, cantidad: 2 })],
      ...PLACA,
    });

    expect(plano.noEntran).toHaveLength(2);
    expect(plano.placas).toEqual([]);
  });

  it("un despiece vacío no rompe", () => {
    const plano = calcularPlanoDeCorte({ piezas: [], ...PLACA });
    expect(plano.placas).toEqual([]);
    expect(plano.pasadas).toBe(0);
    expect(plano.aprovechadoTotal).toBe(0);
  });

  it("una placa sin medidas cargadas no inventa un plano", () => {
    const plano = calcularPlanoDeCorte({
      piezas: [pieza({})],
      placaLargo: 0,
      placaAncho: 0,
    });
    expect(plano.placas).toEqual([]);
  });
});

describe("cuántas placas", () => {
  it("abre una segunda placa recién cuando la primera no da más", () => {
    // Media placa justa: 1370 × 1830 entra una sola vez por placa.
    const plano = calcularPlanoDeCorte({
      piezas: [pieza({ largoMm: 2700, anchoMm: 1800, cantidad: 3, respetaVeta: 1 })],
      ...PLACA,
    });

    expect(plano.placas).toHaveLength(3);
    for (const placa of plano.placas) {
      expect(placa.piezas).toHaveLength(1);
    }
  });

  it("aprovecha la placa antes de abrir otra", () => {
    // Cuatro piezas chicas tienen que entrar todas en una.
    const plano = calcularPlanoDeCorte({
      piezas: [pieza({ largoMm: 600, anchoMm: 400, cantidad: 4 })],
      ...PLACA,
    });

    expect(plano.placas).toHaveLength(1);
  });
});

describe("los recortes que vuelven al stock", () => {
  const plano = calcularPlanoDeCorte({
    piezas: [
      pieza({ largoMm: 1200, anchoMm: 350, cantidad: 2 }),
      pieza({ largoMm: 800, anchoMm: 600, cantidad: 2 }),
    ],
    ...PLACA,
  });

  it("informa el pedazo entero más grande que queda", () => {
    expect(plano.recorteMayor).not.toBeNull();
    expect(plano.recorteMayor!.ancho).toBeGreaterThanOrEqual(150);
    expect(plano.recorteMayor!.alto).toBeGreaterThanOrEqual(150);
  });

  it("ningún recorte se pisa con una pieza", () => {
    for (const placa of plano.placas) {
      for (const r of placa.recortes) {
        for (const p of placa.piezas) {
          expect(sePisan(r, p)).toBe(false);
        }
      }
    }
  });

  it("ningún recorte se sale de la placa", () => {
    for (const placa of plano.placas) {
      for (const r of placa.recortes) {
        expect(r.x + r.ancho).toBeLessThanOrEqual(PLACA.placaLargo);
        expect(r.y + r.alto).toBeLessThanOrEqual(PLACA.placaAncho);
      }
    }
  });

  it("no informa virutas: nada por debajo del mínimo aprovechable", () => {
    for (const placa of plano.placas) {
      for (const r of placa.recortes) {
        expect(Math.min(r.ancho, r.alto)).toBeGreaterThanOrEqual(
          MINIMO_APROVECHABLE,
        );
      }
    }
  });

  it("una placa llena no deja recorte que valga la pena", () => {
    // 2700 × 1820 sobre una placa de 2750 × 1830: a la derecha quedan 45 mm y
    // abajo 5 mm. Las dos son virutas y ninguna se informa.
    const lleno = calcularPlanoDeCorte({
      piezas: [pieza({ largoMm: 2700, anchoMm: 1820, cantidad: 1 })],
      ...PLACA,
    });
    expect(lleno.placas[0]!.recortes).toEqual([]);
    expect(lleno.recorteMayor).toBeNull();
  });

  it("un sobrante angosto pero largo sí cuenta como retal", () => {
    // 2590 de ancho deja 155 mm por 1820 de alto: es finita, pero de ahí sale
    // un travesaño. El corte es por el lado chico, no por la superficie.
    const plano = calcularPlanoDeCorte({
      piezas: [pieza({ largoMm: 2590, anchoMm: 1820, cantidad: 1 })],
      ...PLACA,
    });
    expect(plano.recorteMayor).not.toBeNull();
    expect(plano.recorteMayor!.ancho).toBe(155);
  });
});

/**
 * El aprovechamiento no es una nota del acomodo.
 *
 * Para un despiece dado la superficie útil es fija, así que el porcentaje sale
 * de cuántas placas se usaron y nada más. Se prueba porque es fácil leerlo mal
 * —y de hecho se leyó mal— al compararlo contra un optimizador: a igual
 * cantidad de placas, cualquier acomodo da el mismo número.
 */
describe("qué mide el aprovechamiento", () => {
  it("sale de la cantidad de placas, no de lo bien acomodado que esté", () => {
    const piezas = [pieza({ largoMm: 700, anchoMm: 500, cantidad: 9 })];
    const plano = calcularPlanoDeCorte({ piezas, ...PLACA });

    const util = 700 * 500 * 9;
    const comprado = PLACA.placaLargo * PLACA.placaAncho * plano.placas.length;

    expect(plano.aprovechadoTotal).toBeCloseTo(util / comprado, 6);
  });
});

/**
 * Mandar una pieza a una placa.
 *
 * Quien mira el plano a veces sabe algo que el cálculo no: que esa puerta tiene
 * que salir de la placa nueva y no de la que tiene el borde golpeado. Puede
 * mandarla a la placa que quiera; **el milímetro exacto lo sigue eligiendo el
 * cálculo**, porque una pieza soltada en un punto cualquiera arma patrones que
 * la seccionadora no puede cortar.
 */
describe("piezas mandadas a una placa", () => {
  const piezas = [
    pieza({ largoMm: 800, anchoMm: 600, cantidad: 3 }),
    pieza({ largoMm: 400, anchoMm: 300, cantidad: 2 }),
  ];

  it("la pieza termina en la placa que se pidió", () => {
    const movida = calcularPlanoDeCorte({
      piezas,
      ...PLACA,
      fijadas: [{ indice: 1, unidad: 1, placa: 2 }],
    });

    expect(movida.placas.length).toBeGreaterThanOrEqual(2);
    const enLaDos = movida.placas[1]!.piezas.some(
      (p) => p.indice === 1 && p.unidad === 1,
    );
    expect(enLaDos).toBe(true);
    expect(movida.fijadasDescartadas).toEqual([]);
  });

  it("no se pierde ninguna pieza", () => {
    const movida = calcularPlanoDeCorte({
      piezas,
      ...PLACA,
      fijadas: [{ indice: 1, unidad: 1, placa: 2 }],
    });

    const pedidas = piezas.reduce((t, p) => t + p.cantidad, 0);
    const colocadas = movida.placas.reduce((t, p) => t + p.piezas.length, 0);
    expect(colocadas).toBe(pedidas);
  });

  it("con una pieza mandada a mano, el plano sigue siendo ejecutable", () => {
    const movida = calcularPlanoDeCorte({
      piezas,
      ...PLACA,
      fijadas: [{ indice: 1, unidad: 1, placa: 2 }],
    });

    for (const placa of movida.placas) {
      for (let i = 0; i < placa.piezas.length; i++) {
        for (let j = i + 1; j < placa.piezas.length; j++) {
          expect(sePisan(placa.piezas[i]!, placa.piezas[j]!)).toBe(false);
        }
      }
      for (const p of placa.piezas) {
        expect(p.x + p.ancho).toBeLessThanOrEqual(PLACA.placaLargo);
        expect(p.y + p.alto).toBeLessThanOrEqual(PLACA.placaAncho);
      }
      for (const c of placa.cortes) {
        for (const p of placa.piezas) {
          if (c.direccion === "vertical") {
            const cruzaX = c.x1 > p.x && c.x1 < p.x + p.ancho;
            const cruzaY = c.y1 < p.y + p.alto && c.y2 > p.y;
            expect(cruzaX && cruzaY).toBe(false);
          } else {
            const cruzaY = c.y1 > p.y && c.y1 < p.y + p.alto;
            const cruzaX = c.x1 < p.x + p.ancho && c.x2 > p.x;
            expect(cruzaY && cruzaX).toBe(false);
          }
        }
      }
    }
  });

  it("se puede imponer la orientación", () => {
    const movida = calcularPlanoDeCorte({
      piezas: [pieza({ largoMm: 800, anchoMm: 600, cantidad: 1 })],
      ...PLACA,
      fijadas: [{ indice: 0, unidad: 1, placa: 1, girada: true }],
    });

    expect(movida.placas[0]!.piezas[0]!.girada).toBe(true);
    expect(movida.placas[0]!.piezas[0]!.ancho).toBe(600);
  });

  it("no gira una pieza con veta aunque se lo pidan, y lo dice", () => {
    const movida = calcularPlanoDeCorte({
      piezas: [pieza({ largoMm: 800, anchoMm: 600, cantidad: 1, respetaVeta: 1 })],
      ...PLACA,
      fijadas: [{ indice: 0, unidad: 1, placa: 1, girada: true }],
    });

    expect(movida.fijadasDescartadas).toHaveLength(1);
    expect(movida.placas[0]!.piezas[0]!.girada).toBe(false);
  });

  it("avisa cuando la pieza no entra en la placa que se le pidió", () => {
    // Una placa llena de antemano y una pieza grande mandada ahí.
    const grandes = [
      pieza({ largoMm: 2700, anchoMm: 1800, cantidad: 1 }),
      pieza({ largoMm: 2000, anchoMm: 1500, cantidad: 1 }),
    ];
    const movida = calcularPlanoDeCorte({
      piezas: grandes,
      ...PLACA,
      fijadas: [
        { indice: 0, unidad: 1, placa: 1 },
        { indice: 1, unidad: 1, placa: 1 },
      ],
    });

    expect(movida.fijadasDescartadas).toHaveLength(1);
    // Y la pieza descartada igual se coloca: en otra placa, no se pierde.
    const colocadas = movida.placas.reduce((t, p) => t + p.piezas.length, 0);
    expect(colocadas).toBe(2);
  });
});

/**
 * El acomodo manual, leído de la base.
 *
 * Llega como texto y puede venir de cualquier época: de una versión anterior,
 * de un despiece que cambió, o directamente roto. **Ante la duda se descarta**,
 * y el peor caso es que el plano se recalcule solo — que es lo que hacía antes
 * de que esto existiera. Lo que no puede pasar es que una fila vieja rompa la
 * ficha del corte.
 */
describe("leerAcomodoManual", () => {
  it("lee una lista bien formada", () => {
    const leido = leerAcomodoManual(
      JSON.stringify([
        { indice: 0, unidad: 1, placa: 2 },
        { indice: 3, unidad: 2, placa: 1, girada: true },
      ]),
    );
    expect(leido).toHaveLength(2);
    expect(leido[1]!.girada).toBe(true);
  });

  it("sin nada guardado devuelve vacío", () => {
    expect(leerAcomodoManual(null)).toEqual([]);
    expect(leerAcomodoManual("")).toEqual([]);
  });

  it("un texto que no es JSON no rompe", () => {
    expect(leerAcomodoManual("{esto no es json")).toEqual([]);
    expect(leerAcomodoManual("null")).toEqual([]);
    expect(leerAcomodoManual('"una cadena"')).toEqual([]);
  });

  it("descarta los renglones incompletos y se queda con los sanos", () => {
    const leido = leerAcomodoManual(
      JSON.stringify([
        { indice: 0, unidad: 1, placa: 1 },
        { indice: "cero", unidad: 1, placa: 1 },
        { indice: 1, placa: 1 },
        { indice: 2, unidad: 1, placa: 0 },
        null,
        42,
      ]),
    );
    expect(leido).toHaveLength(1);
    expect(leido[0]).toEqual({ indice: 0, unidad: 1, placa: 1 });
  });

  it("ignora un `girada` que no es booleano", () => {
    const leido = leerAcomodoManual(
      JSON.stringify([{ indice: 0, unidad: 1, placa: 1, girada: "si" }]),
    );
    expect(leido[0]).toEqual({ indice: 0, unidad: 1, placa: 1 });
  });

  it("un acomodo de un despiece que ya no existe no pierde piezas", () => {
    // Apunta a un renglón que no está: el plano lo descarta y acomoda todo.
    const piezas = [pieza({ largoMm: 800, anchoMm: 600, cantidad: 2 })];
    const plano = calcularPlanoDeCorte({
      piezas,
      ...PLACA,
      fijadas: leerAcomodoManual(
        JSON.stringify([{ indice: 99, unidad: 1, placa: 1 }]),
      ),
    });

    const colocadas = plano.placas.reduce((t, p) => t + p.piezas.length, 0);
    expect(colocadas).toBe(2);
  });
});

describe("lo que se lleva la sierra", () => {
  it("cuenta cada corte por el espesor del disco", () => {
    // Un corte horizontal de 1000 mm con un disco de 5 mm se come 5000 mm².
    expect(
      superficieDeSierra(
        {
          cortes: [
            { direccion: "horizontal", x1: 0, y1: 100, x2: 1000, y2: 100 },
            { direccion: "vertical", x1: 400, y1: 0, x2: 400, y2: 200 },
          ],
        },
        5,
      ),
    ).toBe(1000 * 5 + 200 * 5);
  });

  it("sin cortes no se come nada", () => {
    expect(superficieDeSierra({ cortes: [] }, 5)).toBe(0);
  });

  it("acompaña el espesor configurado", () => {
    // El valor sale de /admin/calculadoras: con un disco más grueso, la
    // pérdida crece en proporción. Es lo que la pantalla tiene que poder
    // explicar.
    const cortes = [
      { direccion: "horizontal" as const, x1: 0, y1: 10, x2: 100, y2: 10 },
    ];
    expect(superficieDeSierra({ cortes }, 8)).toBe(
      superficieDeSierra({ cortes }, 4) * 2,
    );
  });
});
