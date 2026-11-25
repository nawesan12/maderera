/**
 * La hoja de corte para la seccionadora: el plano, dicho en el orden en que lo
 * corta la máquina.
 *
 * **Para qué existe.** En el taller hay una seccionadora SCM con una PC con
 * Windows XP que corre WinCut. El optimizador que le armaba los programas
 * (Cutty) no anda, así que el operario carga las medidas a mano en el modo
 * semiautomático: tipea hasta cuatro medidas por teclado y la máquina las
 * corta. Lo que le falta es lo que le daba Cutty: **qué medida tipear, cuántas
 * veces y qué sale de cada corte**. La plataforma ya arma su propio plano
 * guillotina para vender el corte; esto lo convierte en esa lista.
 *
 * **Cómo corta una seccionadora.** Primero parte la placa entera en tiras con
 * cortes longitudinales (a lo largo, de borde a borde); después corta cada tira
 * de través; y si hace falta, cada trozo de nuevo a lo largo. Cada nivel cambia
 * de dirección y cada corte atraviesa de borde a borde el trozo que parte. Es
 * exactamente un árbol guillotina, y eso es lo que se arma acá.
 *
 * **El árbol se rearma desde las piezas, no desde el registro de cortes del
 * motor.** `plano.ts` guarda dónde quedó cada pieza y los cortes en el orden en
 * que se le ocurrieron al acomodar, que no es el orden de la máquina: el motor
 * a veces parte primero a lo alto y después a lo ancho. Lo que no cambia es que
 * el acomodo es guillotina. Así que, para cada trozo, se buscan las líneas que
 * lo cruzan de borde a borde sin tocar ninguna pieza —primero en la dirección
 * que le toca a ese nivel— y se parte por ahí. En un patrón guillotina esa
 * búsqueda siempre encuentra un corte, y cualquier corte que se elija deja dos
 * mitades que también lo son: no hay forma de que quede trabado.
 *
 * **La medida que se tipea es la de la pieza, y la máquina descuenta la
 * sierra.** El motor deja entre pieza y pieza exactamente el ancho del disco
 * del trabajo (`x` de la siguiente = `x + ancho + sierra`, ver `partirLibre`),
 * así que la distancia entre dos cortes es «pieza + sierra». Una seccionadora
 * trabaja así: se le da la medida de la tira y el empujador avanza esa medida
 * más el disco, que tiene cargado en su configuración. Por eso la hoja da la
 * medida limpia (600, no 604,4) y dice al pie cuánta sierra supone. Si un día
 * la máquina no tuviera el disco cargado, habría que sumárselo a cada medida;
 * es lo primero que se mira en la visita (ver `docs/RELEVAMIENTO-TALLER.md`).
 *
 * **Los sobrantes van al final.** Una tira se corta igual esté donde esté sobre
 * la placa, así que si el acomodo dejó un hueco entre dos tiras, en la hoja las
 * tiras van juntas desde el borde de referencia y todo lo que sobra queda en un
 * solo pedazo, del lado del empujador. Es lo que haría el operario y lo que
 * deja el retal más grande. El dibujo de la hoja es el de esta secuencia, no el
 * de la ficha: el número de cada corte en el dibujo es el mismo de la lista.
 *
 * Sin base de datos y sin `server-only`: es geometría pura, con tests.
 */

import { MINIMO_APROVECHABLE, type PiezaColocada, type PlanoDeCorte } from "./plano";

/**
 * En qué eje se miden las tiras de un trozo.
 *
 * `y` son los cortes **longitudinales**: líneas a lo largo de la placa (el eje
 * `x` del plano es el largo y la veta), que dejan tiras medidas a lo ancho.
 * `x` son los **transversales**, de través, medidos a lo largo.
 */
export type Eje = "x" | "y";

export interface Rect {
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

/** Un pedazo de placa en el árbol de cortes. */
export type Trozo =
  | { tipo: "pieza"; rect: Rect; pieza: PiezaColocada }
  | { tipo: "sobrante"; rect: Rect }
  | {
      tipo: "partido";
      rect: Rect;
      /** En qué eje se miden las tiras que salen de este trozo. */
      eje: Eje;
      /** Nivel de la seccionadora: 1 longitudinal, 2 transversal, 3… */
      nivel: number;
      /** Las tiras, en el orden en que se cortan desde el borde. */
      hijos: Trozo[];
      /**
       * Si la última tira no necesita corte: llega justo al borde y es lo que
       * queda del lado del empujador.
       */
      ultimaSinCorte: boolean;
      /** Lo que queda después del último corte, si queda algo. */
      sobra: Rect | null;
    };

/** Qué sale de un paso. */
export interface Salida {
  cantidad: number;
  tipo: "pieza" | "trozo";
  /** Lo que mide sobre la placa: largo × ancho, ya girada si va girada. */
  largo: number;
  ancho: number;
  /** Solo si es pieza: de qué renglón del despiece es (1, 2, 3…). */
  renglon?: number;
  etiqueta?: string | null;
  girada?: boolean;
  /** Solo si es trozo: el número de la operación donde se sigue cortando. */
  sigueEn?: number;
  /**
   * Si de un mismo paso salen trozos distintos —dos tiras de 560 que después
   * se cortan diferente—, una letra para no confundirlos: A, B…
   */
  letra?: string;
}

/** Una medida que se tipea, y cuántas veces seguidas. */
export interface PasoDeCorte {
  /** El número que lleva en la lista y en el dibujo. */
  numero: number;
  /** Lo que se tipea en la máquina, en milímetros. */
  medida: number;
  veces: number;
  /**
   * Si la última de las `veces` no lleva corte porque es lo que queda: la tira
   * llega justo al borde. Se dice para que nadie busque cortar 0 mm.
   */
  ultimaSinCorte: boolean;
  sale: Salida[];
}

export interface OperacionDeCorte {
  /** Número de la operación dentro del patrón: 1, 2, 3… */
  numero: number;
  nivel: number;
  direccion: "longitudinal" | "transversal";
  /** Lo que mide el trozo que se pone en la máquina: largo × ancho. */
  largo: number;
  ancho: number;
  /** Cuántos trozos iguales se cortan igual. */
  repeticiones: number;
  /** De qué paso salió el trozo. Nulo es la placa. */
  delPaso: number | null;
  /** La letra del trozo, si de ese paso salen trozos distintos. */
  letra?: string;
  pasos: PasoDeCorte[];
  /**
   * Los pasos en tandas de hasta cuatro medidas, que es lo que acepta el
   * semiautomático de WinCut de una vez.
   */
  tandas: PasoDeCorte[][];
  /** Lo que queda al final, del lado del empujador. */
  sobra: { largo: number; ancho: number; tipo: "retal" | "desperdicio" } | null;
}

export interface CorteDibujado {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  paso: number;
}

export interface PatronDeCorte {
  /** Los números de placa del plano que llevan este patrón. */
  placas: number[];
  arbol: Trozo;
  operaciones: OperacionDeCorte[];
  dibujo: {
    piezas: { rect: Rect; pieza: PiezaColocada }[];
    sobrantes: { rect: Rect; tipo: "retal" | "desperdicio" }[];
    cortes: CorteDibujado[];
  };
  /** Piezas de una placa de este patrón. */
  piezasPorPlaca: number;
  /** Pasadas de sierra de una placa de este patrón. */
  pasadasPorPlaca: number;
  seVendeEntera: boolean;
}

export interface HojaDeCorte {
  placaLargo: number;
  placaAncho: number;
  anchoSierra: number;
  patrones: PatronDeCorte[];
  /** Placas en total, contando las repetidas. */
  placas: number;
  totalPiezas: number;
  noEntran: PlanoDeCorte["noEntran"];
}

/** Las medidas vienen de restar con el disco (4,4 mm): se comparan con margen. */
const EPS = 0.01;

/**
 * Redondea a la milésima. Sumar 4,4 mm de sierra seis veces da 26,400000000000002
 * y una medida así no se compara ni se escribe: las posiciones se redondean
 * apenas se calculan.
 */
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Cuántas medidas acepta el semiautomático de una vez. */
export const MEDIDAS_POR_TANDA = 4;

/** Error que no debería pasar nunca: el plano no era guillotina. */
export class PatronNoGuillotina extends Error {}

/**
 * Arma la hoja de corte de todo el plano.
 *
 * Las placas con el mismo patrón —las mismas piezas del mismo renglón en el
 * mismo lugar— van juntas como «×N placas»: el operario corta la misma
 * secuencia N veces y no tiene por qué leerla N veces.
 */
export function armarHojaDeCorte(plano: PlanoDeCorte): HojaDeCorte {
  const patrones: PatronDeCorte[] = [];
  const porFirma = new Map<string, PatronDeCorte>();

  for (const placa of plano.placas) {
    const arbol = partir(
      { x: 0, y: 0, ancho: plano.placaLargo, alto: plano.placaAncho },
      placa.piezas.map((p) => ({
        ...p,
        x: r3(p.x),
        y: r3(p.y),
        ancho: r3(p.ancho),
        alto: r3(p.alto),
      })),
      plano.anchoSierra,
      1,
      0,
    );
    const clave = firma(arbol);
    const igual = porFirma.get(clave);
    if (igual) {
      igual.placas.push(placa.numero);
      continue;
    }

    const { operaciones, deCadaTrozo } = operacionesDe(arbol);
    const patron: PatronDeCorte = {
      placas: [placa.numero],
      arbol,
      operaciones,
      dibujo: dibujoDe(arbol, deCadaTrozo, plano.anchoSierra),
      piezasPorPlaca: placa.piezas.length,
      pasadasPorPlaca: operaciones.reduce(
        (t, op) =>
          t +
          op.repeticiones *
            op.pasos.reduce((s, p) => s + p.veces - (p.ultimaSinCorte ? 1 : 0), 0),
        0,
      ),
      seVendeEntera: placa.seVendeEntera,
    };
    porFirma.set(clave, patron);
    patrones.push(patron);
  }

  return {
    placaLargo: plano.placaLargo,
    placaAncho: plano.placaAncho,
    anchoSierra: plano.anchoSierra,
    patrones,
    placas: plano.placas.length,
    totalPiezas: plano.totalPiezas,
    noEntran: plano.noEntran,
  };
}

/** El eje que le toca a un nivel: los impares son longitudinales. */
function ejeDelNivel(nivel: number): Eje {
  return nivel % 2 === 1 ? "y" : "x";
}

const desde = (r: Rect, eje: Eje) => (eje === "y" ? r.y : r.x);
const largoEn = (r: Rect, eje: Eje) => (eje === "y" ? r.alto : r.ancho);

/**
 * Parte un trozo en tiras por el eje de su nivel, y cada tira por el otro.
 *
 * `saltos` cuenta los niveles seguidos sin ningún corte: si un trozo con más de
 * una pieza no se puede partir en ninguna de las dos direcciones, el patrón no
 * era guillotina y es mejor decirlo que inventar una secuencia.
 */
function partir(
  rect: Rect,
  piezas: PiezaColocada[],
  sierra: number,
  nivel: number,
  saltos: number,
): Trozo {
  if (piezas.length === 0) return { tipo: "sobrante", rect };

  if (piezas.length === 1) {
    const p = piezas[0]!;
    if (Math.abs(p.ancho - rect.ancho) <= EPS && Math.abs(p.alto - rect.alto) <= EPS) {
      return { tipo: "pieza", rect, pieza: { ...p, x: rect.x, y: rect.y } };
    }
  }

  const eje = ejeDelNivel(nivel);
  const tiras = tirasEn(piezas, eje, sierra);
  const total = largoEn(rect, eje);
  const usado =
    tiras.reduce((t, tira) => t + (tira.hasta - tira.desde), 0) +
    (tiras.length - 1) * sierra;
  const resto = r3(total - usado);

  if (tiras.length === 1 && resto <= EPS) {
    // Nada que cortar en esta dirección: el trozo pasa entero al nivel que
    // sigue, que corta de través.
    if (saltos >= 1) {
      throw new PatronNoGuillotina(
        `No se encontró un corte de borde a borde en un trozo de ${rect.ancho} × ${rect.alto}`,
      );
    }
    return partir(rect, piezas, sierra, nivel + 1, saltos + 1);
  }

  /*
   * Las tiras con la misma medida se cortan seguidas —así la medida se tipea
   * una vez con su cantidad— y, entre ellas, las que tienen el mismo contenido
   * van juntas para que su corte siguiente se lea una sola vez. El orden entre
   * medidas distintas es el del acomodo, que ya pone primero las grandes.
   */
  const conHijo = tiras.map((tira, i) => ({ tira, i }));
  const ordenMedida = new Map<string, number>();
  conHijo.forEach(({ tira, i }) => {
    const m = clave(tira.hasta - tira.desde);
    if (!ordenMedida.has(m)) ordenMedida.set(m, i);
  });

  let cursor = desde(rect, eje);
  const hijos: Trozo[] = [];
  const armados = conHijo.map(({ tira }) => {
    const medida = r3(tira.hasta - tira.desde);
    return { tira, medida, firma: "" as string };
  });

  // Primero se arma cada hijo en su lugar, para poder comparar contenidos.
  const provisorios = armados.map((a) => {
    const r = rectDeTira(rect, eje, a.tira.desde, a.medida);
    const hijo = partir(r, a.tira.piezas, sierra, nivel + 1, 0);
    a.firma = firma(hijo);
    return { ...a, hijo };
  });

  const ordenFirma = new Map<string, number>();
  provisorios.forEach((p, i) => {
    if (!ordenFirma.has(p.firma)) ordenFirma.set(p.firma, i);
  });

  provisorios.sort(
    (a, b) =>
      ordenMedida.get(clave(a.medida))! - ordenMedida.get(clave(b.medida))! ||
      ordenFirma.get(a.firma)! - ordenFirma.get(b.firma)!,
  );

  // Y después se los corre contra el borde, uno detrás del otro.
  for (const p of provisorios) {
    const corrimiento = cursor - p.tira.desde;
    hijos.push(mover(p.hijo, eje, corrimiento));
    cursor = r3(cursor + p.medida + sierra);
  }

  const ultimaSinCorte = resto <= EPS;
  const fin = desde(rect, eje) + total;
  // Después del último corte: lo que va del corte al borde, si queda algo.
  const finUltima = cursor - sierra;
  const largoSobra = r3(fin - finUltima - sierra);
  const sobra =
    !ultimaSinCorte && largoSobra > EPS
      ? rectDeTira(rect, eje, finUltima + sierra, largoSobra)
      : null;

  return { tipo: "partido", rect, eje, nivel, hijos, ultimaSinCorte, sobra };
}

/** Una medida como clave, sin el ruido del punto flotante. */
function clave(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

interface Tira {
  desde: number;
  hasta: number;
  piezas: PiezaColocada[];
}

/**
 * Las tiras de un trozo en un eje: las franjas que ocupan las piezas, juntas
 * cuando entre una y otra no entra la sierra.
 *
 * Dos piezas cuyas franjas se pisan, o que quedan más cerca que el ancho del
 * disco, no se pueden separar con un corte en ese eje: van en la misma tira y
 * se separan en el nivel siguiente.
 */
function tirasEn(piezas: PiezaColocada[], eje: Eje, sierra: number): Tira[] {
  const ordenadas = [...piezas].sort(
    (a, b) => desde(a, eje) - desde(b, eje) || largoEn(a, eje) - largoEn(b, eje),
  );
  const tiras: Tira[] = [];

  for (const p of ordenadas) {
    const ini = desde(p, eje);
    const fin = ini + largoEn(p, eje);
    const ultima = tiras[tiras.length - 1];
    if (ultima && ini < ultima.hasta + sierra - EPS) {
      ultima.hasta = Math.max(ultima.hasta, fin);
      ultima.piezas.push(p);
    } else {
      tiras.push({ desde: ini, hasta: fin, piezas: [p] });
    }
  }

  return tiras;
}

function rectDeTira(rect: Rect, eje: Eje, ini: number, medida: number): Rect {
  return eje === "y"
    ? { x: rect.x, y: r3(ini), ancho: rect.ancho, alto: r3(medida) }
    : { x: r3(ini), y: rect.y, ancho: r3(medida), alto: rect.alto };
}

/** Corre un trozo entero —con todo lo que tiene adentro— sobre un eje. */
function mover(trozo: Trozo, eje: Eje, d: number): Trozo {
  if (Math.abs(d) <= 0) return trozo;
  const r = (x: Rect): Rect =>
    eje === "y" ? { ...x, y: r3(x.y + d) } : { ...x, x: r3(x.x + d) };

  if (trozo.tipo === "pieza") {
    const rect = r(trozo.rect);
    return { tipo: "pieza", rect, pieza: { ...trozo.pieza, x: rect.x, y: rect.y } };
  }
  if (trozo.tipo === "sobrante") return { tipo: "sobrante", rect: r(trozo.rect) };
  return {
    ...trozo,
    rect: r(trozo.rect),
    hijos: trozo.hijos.map((h) => mover(h, eje, d)),
    sobra: trozo.sobra ? r(trozo.sobra) : null,
  };
}

/**
 * Lo que identifica un trozo sin mirar dónde está: qué piezas, de qué renglón,
 * de qué medida, en qué orden. Dos placas con la misma firma se cortan igual.
 */
function firma(trozo: Trozo): string {
  const m = `${clave(trozo.rect.ancho)}x${clave(trozo.rect.alto)}`;
  if (trozo.tipo === "pieza") {
    return `P${trozo.pieza.indice}${trozo.pieza.girada ? "g" : ""}:${m}`;
  }
  if (trozo.tipo === "sobrante") return `S:${m}`;
  return `T${trozo.eje}${trozo.ultimaSinCorte ? "!" : ""}:${m}(${trozo.hijos.map(firma).join(",")})`;
}

/**
 * Las operaciones en el orden de la máquina: primero la placa entera, después
 * todas las tiras, después todos los trozos de las tiras.
 *
 * Por nivel y no tira por tira, porque es como se trabaja en una seccionadora:
 * se sacan todas las tiras, y recién después se las va pasando de través.
 *
 * Devuelve también qué operación le tocó a cada trozo del árbol, que es lo que
 * usa el dibujo para rotular cada corte con el número de su paso.
 */
function operacionesDe(arbol: Trozo): {
  operaciones: OperacionDeCorte[];
  deCadaTrozo: Map<Trozo, OperacionDeCorte>;
} {
  const operaciones: OperacionDeCorte[] = [];
  const deCadaTrozo = new Map<Trozo, OperacionDeCorte>();
  if (arbol.tipo !== "partido") return { operaciones, deCadaTrozo };

  type Partido = Extract<Trozo, { tipo: "partido" }>;
  interface Pendiente {
    /** Los trozos iguales que se cortan con esta operación. */
    trozos: Partido[];
    repeticiones: number;
    delPaso: number | null;
    /** La salida del paso que los produjo, para decirle dónde se sigue. */
    salida: Salida | null;
  }

  let pendientes: Pendiente[] = [{ trozos: [arbol], repeticiones: 1, delPaso: null, salida: null }];
  let numeroDePaso = 0;

  while (pendientes.length > 0) {
    const siguientes: Pendiente[] = [];

    for (const { trozos, repeticiones, delPaso, salida: deDonde } of pendientes) {
      const trozo = trozos[0]!;
      const op: OperacionDeCorte = {
        numero: operaciones.length + 1,
        nivel: trozo.nivel,
        direccion: trozo.eje === "y" ? "longitudinal" : "transversal",
        largo: trozo.rect.ancho,
        ancho: trozo.rect.alto,
        repeticiones,
        delPaso,
        pasos: [],
        tandas: [],
        sobra: trozo.sobra
          ? {
              largo: trozo.sobra.ancho,
              ancho: trozo.sobra.alto,
              tipo: tipoDeSobrante(trozo.sobra),
            }
          : null,
      };
      operaciones.push(op);
      for (const t of trozos) deCadaTrozo.set(t, op);
      if (deDonde) {
        deDonde.sigueEn = op.numero;
        if (deDonde.letra) op.letra = deDonde.letra;
      }

      // Los hijos seguidos con la misma medida son un solo paso.
      let i = 0;
      while (i < trozo.hijos.length) {
        const medida = largoEn(trozo.hijos[i]!.rect, trozo.eje);
        let j = i;
        while (
          j < trozo.hijos.length &&
          Math.abs(largoEn(trozo.hijos[j]!.rect, trozo.eje) - medida) <= EPS
        ) {
          j++;
        }
        numeroDePaso++;
        const paso: PasoDeCorte = {
          numero: numeroDePaso,
          medida,
          veces: j - i,
          ultimaSinCorte: j === trozo.hijos.length && trozo.ultimaSinCorte,
          sale: [],
        };

        // Lo que sale, sumando lo que es igual. Los trozos iguales de todas
        // las repeticiones van juntos a la misma operación siguiente.
        const porFirma = new Map<string, { salida: Salida; hijos: Trozo[] }>();
        for (let k = i; k < j; k++) {
          const hijos = trozos.map((t) => t.hijos[k]!);
          const hijo = hijos[0]!;
          const f = firma(hijo);
          const ya = porFirma.get(f);
          if (ya) {
            ya.salida.cantidad += repeticiones;
            ya.hijos.push(...hijos);
            continue;
          }
          const salida: Salida =
            hijo.tipo === "pieza"
              ? {
                  cantidad: repeticiones,
                  tipo: "pieza",
                  largo: hijo.rect.ancho,
                  ancho: hijo.rect.alto,
                  renglon: hijo.pieza.indice + 1,
                  etiqueta: hijo.pieza.etiqueta ?? null,
                  girada: hijo.pieza.girada,
                }
              : { cantidad: repeticiones, tipo: "trozo", largo: hijo.rect.ancho, ancho: hijo.rect.alto };
          porFirma.set(f, { salida, hijos: [...hijos] });
          paso.sale.push(salida);
        }

        const queSiguen = paso.sale.filter((x) => x.tipo === "trozo");
        if (queSiguen.length > 1) {
          queSiguen.forEach((x, k) => (x.letra = String.fromCharCode(65 + k)));
        }

        for (const { salida, hijos } of porFirma.values()) {
          if (hijos[0]!.tipo === "partido") {
            siguientes.push({
              trozos: hijos as Partido[],
              repeticiones: salida.cantidad,
              delPaso: paso.numero,
              salida,
            });
          }
        }

        op.pasos.push(paso);
        i = j;
      }

      for (let t = 0; t < op.pasos.length; t += MEDIDAS_POR_TANDA) {
        op.tandas.push(op.pasos.slice(t, t + MEDIDAS_POR_TANDA));
      }
    }

    pendientes = siguientes;
  }

  return { operaciones, deCadaTrozo };
}

/** Retal si da para guardar; si no, desperdicio. Ver `MINIMO_APROVECHABLE`. */
function tipoDeSobrante(r: Rect): "retal" | "desperdicio" {
  return r.ancho >= MINIMO_APROVECHABLE && r.alto >= MINIMO_APROVECHABLE
    ? "retal"
    : "desperdicio";
}

/**
 * El dibujo de la placa, con cada corte rotulado con el número de su paso.
 *
 * Las operaciones que se repiten (×2 tiras iguales) se dibujan en cada una de
 * las tiras con el mismo número: es el mismo paso hecho dos veces.
 */
function dibujoDe(
  arbol: Trozo,
  deCadaTrozo: Map<Trozo, OperacionDeCorte>,
  sierra: number,
): PatronDeCorte["dibujo"] {
  const piezas: PatronDeCorte["dibujo"]["piezas"] = [];
  const sobrantes: PatronDeCorte["dibujo"]["sobrantes"] = [];
  const cortes: CorteDibujado[] = [];

  const recorrer = (t: Trozo) => {
    if (t.tipo === "pieza") {
      piezas.push({ rect: t.rect, pieza: t.pieza });
      return;
    }
    if (t.tipo === "sobrante") {
      sobrantes.push({ rect: t.rect, tipo: tipoDeSobrante(t.rect) });
      return;
    }

    // El paso de cada tira, en el orden de los hijos.
    const numeros: number[] = [];
    for (const paso of deCadaTrozo.get(t)?.pasos ?? []) {
      for (let v = 0; v < paso.veces; v++) numeros.push(paso.numero);
    }

    const finTrozo = desde(t.rect, t.eje) + largoEn(t.rect, t.eje);
    t.hijos.forEach((h, i) => {
      if (!(i === t.hijos.length - 1 && t.ultimaSinCorte)) {
        // El centro del disco, sin pasarse del borde cuando lo que queda es
        // más fino que la sierra.
        const fin = desde(h.rect, t.eje) + largoEn(h.rect, t.eje);
        const c = r3(Math.min(fin + sierra / 2, finTrozo));
        const paso = numeros[i] ?? 0;
        cortes.push(
          t.eje === "y"
            ? { x1: t.rect.x, y1: c, x2: t.rect.x + t.rect.ancho, y2: c, paso }
            : { x1: c, y1: t.rect.y, x2: c, y2: t.rect.y + t.rect.alto, paso },
        );
      }
      recorrer(h);
    });
    if (t.sobra) sobrantes.push({ rect: t.sobra, tipo: tipoDeSobrante(t.sobra) });
  };

  recorrer(arbol);
  return { piezas, sobrantes, cortes };
}
