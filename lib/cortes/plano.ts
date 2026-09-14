/**
 * El plano de corte: dónde cae cada pieza sobre cada placa.
 *
 * **Para qué existe.** No se puede vender un corte sin ver antes cómo queda
 * adentro de la placa. De ese acomodo salen las tres cosas que decide quien
 * atiende el mostrador:
 *
 * 1. **Cuántas placas** hacen falta. Cada placa es un producto del catálogo con
 *    su medida y su precio, y depende del material que pidió el cliente.
 * 2. **Si se vende el corte o la placa entera.** Si de una placa sale más de la
 *    mitad, lo que queda ya no sirve para otro trabajo: se le vende la placa
 *    entera. Ver `UMBRAL_PLACA_ENTERA`.
 * 3. **Cuántas pasadas** se cobran, que es de donde sale el precio del corte.
 *
 * Y hay un cuarto motivo que es plata directa: **cuanto mejor entren las piezas,
 * menos placas se gastan**. Un punto de aprovechamiento no es estética.
 *
 * **Corte guillotina.** Una seccionadora corta de borde a borde: no sabe hacer
 * una L. Cada corte parte un rectángulo en dos y después se sigue adentro de
 * cada mitad. Por eso el acomodo es una **partición recursiva**: se apoya la
 * pieza en una esquina del espacio libre, se parte el resto con un corte recto,
 * y se sigue. Todo lo que sale de acá se puede ejecutar tal cual.
 *
 * **Es una heurística y hay que decirlo.** El problema es NP-difícil. Se prueban
 * varios órdenes de entrada y las dos formas de partir cada sobrante, y gana el
 * resultado que gaste menos placas. Un optimizador de verdad prueba muchas más
 * combinaciones y además reusa los recortes de trabajos anteriores, que esto no
 * hace. Si el número queda peor que el de CutMaster, esa diferencia es lo que
 * vale el optimizador, y conviene verla escrita en vez de suponerla.
 *
 * Sin base de datos y sin `server-only`: es geometría pura. Por eso se puede
 * probar, y por eso puede correr también en el navegador mientras alguien carga
 * el despiece en el mostrador.
 */

import { ANCHO_DE_SIERRA_MM } from "@/lib/calculations";

/**
 * Desde qué medida un sobrante deja de ser viruta y pasa a ser retal.
 *
 * 150 mm de lado: por debajo de eso no entra ni un estante angosto ni un
 * travesaño, y guardarlo ocupa lugar en el depósito sin que nadie lo vaya a
 * usar. Es un criterio de taller, no una cuenta: conviene confirmarlo en la
 * visita y, si hace falta, moverlo.
 */
export const MINIMO_APROVECHABLE = 150;

/**
 * A partir de qué parte de una placa deja de venderse el corte y se vende la
 * placa entera.
 *
 * **Es una regla del negocio, no una cuenta.** Si de una placa sale más de la
 * mitad, lo que queda ya no alcanza para otro trabajo: la placa quedó
 * consumida aunque el cliente se lleve el 55 %. Cobrar solo las pasadas ahí
 * sería regalar la diferencia, así que se le vende la placa entera y el resto
 * se lo lleva él.
 *
 * Al revés también importa: por debajo de la mitad el sobrante sirve, y
 * venderle la placa entera sería cobrarle de más.
 */
export const UMBRAL_PLACA_ENTERA = 0.5;

export interface PiezaAcortar {
  largoMm: number;
  anchoMm: number;
  cantidad: number;
  /** 1 si la veta manda y la pieza no se puede girar. */
  respetaVeta: number;
  etiqueta?: string | null;
  cantoLargo?: number;
  cantoAncho?: number;
}

/** Una pieza ya ubicada sobre una placa, en milímetros desde el borde. */
export interface PiezaColocada {
  x: number;
  y: number;
  /** Lo que mide sobre la placa, ya girada si hizo falta. */
  ancho: number;
  alto: number;
  /** Qué renglón del despiece es, para poder nombrarla. */
  indice: number;
  /** Cuál de las N unidades de ese renglón. */
  unidad: number;
  etiqueta?: string | null;
  girada: boolean;
  /** Las medidas como las pidió el cliente, sin girar. */
  largoOriginal: number;
  anchoOriginal: number;
}

/**
 * Un pedazo de placa que queda entero y sirve para otro trabajo.
 *
 * Con corte guillotina los sobrantes son rectángulos exactos, no formas raras:
 * eso los hace guardables —vuelven al stock como retal— y es justamente lo que
 * un optimizador de verdad sabe reusar y esto todavía no.
 */
export interface Recorte {
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

/** Un corte que hay que hacer, de borde a borde del pedazo que parte. */
export interface LineaDeCorte {
  direccion: "horizontal" | "vertical";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PlacaDelPlano {
  numero: number;
  piezas: PiezaColocada[];
  /** Los cortes que hay que hacer sobre esta placa. */
  cortes: LineaDeCorte[];
  /** Los pedazos enteros que sobran, del más grande al más chico. */
  recortes: Recorte[];
  /** Superficie de placa aprovechada, entre 0 y 1. */
  aprovechado: number;
  /**
   * Si de esta placa sale más de la mitad y por eso se vende entera.
   *
   * La decisión es **por placa** y no por trabajo: un despiece de tres placas
   * puede tener dos que se venden enteras y una tercera de la que apenas sale
   * un 30 % y se cobra por pasada. Mezclarlas en un solo promedio le cobraría
   * de más a unos y de menos a otros.
   */
  seVendeEntera: boolean;
}

export interface PlanoDeCorte {
  placaLargo: number;
  placaAncho: number;
  anchoSierra: number;
  placas: PlacaDelPlano[];
  /** Piezas que no entran en una placa entera. Es un error de carga. */
  noEntran: { indice: number; largoMm: number; anchoMm: number }[];
  totalPiezas: number;
  /**
   * Superficie útil sobre superficie de placa comprada, entre 0 y 1.
   *
   * **Ojo con leerlo como una nota del acomodo.** Para un despiece dado la
   * superficie útil es fija: son las piezas que pidió el cliente. Así que este
   * número depende solo de **cuántas placas** se usaron, y decir "aprovechamos
   * el 64 %" es otra forma de decir "entraron en tres placas". Dos planos con
   * la misma cantidad de placas dan exactamente el mismo porcentaje, por bien o
   * mal acomodados que estén.
   *
   * Lo que sí distingue un acomodo bueno de uno malo, a igual cantidad de
   * placas, es el **tamaño de los recortes**: si lo que sobra es un pedazo
   * entero vuelve al stock, y si son tiras finas se tira.
   */
  aprovechadoTotal: number;
  /**
   * Pasadas de sierra del trabajo.
   *
   * Cada corte que parte un pedazo en dos es una pasada. No incluye el despunte
   * de los bordes de fábrica, que el taller hace o no según cómo venga la placa.
   */
  pasadas: number;
  /**
   * El pedazo entero más grande que queda, de todo el trabajo.
   *
   * Es el número que decide si el sobrante vuelve al stock o va al contenedor.
   */
  recorteMayor: Recorte | null;
  /** Cuántas placas se venden enteras porque sale de ellas más de la mitad. */
  placasEnteras: number;
  /**
   * Pasadas que sí se cobran: las de las placas que **no** se venden enteras.
   *
   * Cuando la placa se vende entera el corte va sin cargo —el cliente ya pagó
   * el material completo—, así que sumar esas pasadas al precio sería cobrarle
   * dos veces la misma placa.
   */
  pasadasCobrables: number;
  /**
   * Las piezas mandadas a mano que no se pudieron ubicar donde se pidió.
   *
   * Pasa cuando en esa placa ya no entran —porque el despiece cambió, o porque
   * se la mandó a una placa que quedó llena—. La pieza vuelve al acomodo
   * automático y esto permite decírselo a quien la movió, en vez de moverla en
   * silencio a otro lado.
   */
  fijadasDescartadas: PiezaFijada[];
}

/**
 * Una pieza que alguien mandó a una placa determinada.
 *
 * **Se fija la placa, no la coordenada.** Fue la primera idea y estaba mal: si
 * se guarda un punto exacto, al rehacer el plano esa esquina no existe —existía
 * porque otras piezas ya estaban puestas, y en una placa virgen no hay dónde
 * apoyarla—. Peor: dejar soltar una pieza en cualquier punto arma patrones con
 * forma de molinete que la seccionadora **no puede cortar**, porque no sabe
 * hacer una L.
 *
 * Mandar la pieza a una placa sí es una decisión que se puede respetar siempre:
 * se la coloca primero, con el mismo criterio de calce de todas, y el resto se
 * acomoda alrededor. Es la decisión que de verdad se toma mirando el plano
 * —"esta puerta que salga de la placa nueva, no de la que tiene el borde
 * golpeado"—; el milímetro exacto lo resuelve mejor el cálculo.
 */
export interface PiezaFijada {
  indice: number;
  unidad: number;
  /** Número de placa, empezando en 1. */
  placa: number;
  /** Si además se le impuso la orientación. Sin esto, la elige el cálculo. */
  girada?: boolean;
}

/** Una orientación posible de una pieza sobre la placa. */
interface Orientacion {
  ancho: number;
  alto: number;
  girada: boolean;
}

interface Unidad {
  indice: number;
  unidad: number;
  pieza: PiezaAcortar;
  /** Las orientaciones que entran en la placa. Nunca vacío. */
  posibles: Orientacion[];
}

/** Un rectángulo de placa todavía sin usar. */
interface Libre {
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

/** Una placa mientras se la está acomodando. */
interface PlacaEnCurso {
  piezas: PiezaColocada[];
  cortes: LineaDeCorte[];
  libres: Libre[];
}

/**
 * Arma el plano.
 *
 * `placaLargo` corre horizontal y es el sentido de la veta: una pieza que la
 * respeta apoya su largo sobre ese eje y no se gira.
 */
export function calcularPlanoDeCorte({
  piezas,
  placaLargo,
  placaAncho,
  anchoSierra = ANCHO_DE_SIERRA_MM,
  fijadas = [],
}: {
  piezas: PiezaAcortar[];
  placaLargo: number;
  placaAncho: number;
  anchoSierra?: number;
  /** Las que alguien movió a mano. Se colocan primero y no se tocan. */
  fijadas?: PiezaFijada[];
}): PlanoDeCorte {
  const vacio: PlanoDeCorte = {
    placaLargo,
    placaAncho,
    anchoSierra,
    placas: [],
    noEntran: [],
    totalPiezas: 0,
    aprovechadoTotal: 0,
    pasadas: 0,
    recorteMayor: null,
    placasEnteras: 0,
    pasadasCobrables: 0,
    fijadasDescartadas: [],
  };

  if (placaLargo <= 0 || placaAncho <= 0) return vacio;

  const unidades: Unidad[] = [];
  const noEntran: PlanoDeCorte["noEntran"] = [];

  piezas.forEach((pieza, indice) => {
    const posibles = orientacionesPosibles(pieza, placaLargo, placaAncho);
    for (let u = 1; u <= Math.max(0, Math.floor(pieza.cantidad)); u++) {
      if (posibles.length === 0) {
        noEntran.push({
          indice,
          largoMm: pieza.largoMm,
          anchoMm: pieza.anchoMm,
        });
        continue;
      }
      unidades.push({ indice, unidad: u, pieza, posibles });
    }
  });

  if (unidades.length === 0) return { ...vacio, noEntran };

  /*
   * Se prueban varios órdenes y las dos formas de partir, y gana el mejor.
   *
   * Ningún criterio sirve para todos los despieces: ordenar por superficie
   * acomoda bien los muebles, y ordenar por el lado más largo salva los
   * despieces con una pieza larga y flaca que, entrando tarde, obliga a abrir
   * una placa entera para ella sola. Probar ocho combinaciones cuesta
   * milisegundos y evita elegir de antemano por el cliente.
   */
  const criterios: ((o: Orientacion) => number)[] = [
    (o) => o.ancho * o.alto,
    (o) => Math.max(o.ancho, o.alto),
    (o) => o.alto,
    (o) => o.ancho,
  ];

  /*
   * Lo fijado a mano se coloca primero y no entra en la optimización: es una
   * decisión de quien mira la placa, y el cálculo trabaja alrededor.
   */
  const clave = (i: number, u: number) => `${i}/${u}`;
  const porClave = new Map(fijadas.map((f) => [clave(f.indice, f.unidad), f]));
  const aFijar = unidades.filter((u) => porClave.has(clave(u.indice, u.unidad)));
  const sueltas = unidades.filter(
    (u) => !porClave.has(clave(u.indice, u.unidad)),
  );

  let descartadas: PiezaFijada[] = [];
  let mejor: PlacaEnCurso[] | null = null;

  for (const criterio of criterios) {
    const orden = [...sueltas].sort(
      (a, b) =>
        criterio(referencia(b)) - criterio(referencia(a)) ||
        referencia(b).ancho - referencia(a).ancho,
    );

    for (const partir of ["corto", "largo"] as const) {
      const semilla = sembrarFijadas(
        aFijar,
        porClave,
        placaLargo,
        placaAncho,
        anchoSierra,
        partir,
      );
      const intento = acomodar(
        [...orden, ...semilla.devueltas],
        placaLargo,
        placaAncho,
        anchoSierra,
        partir,
        semilla.placas,
      );
      if (!mejor || esMejor(intento, mejor)) {
        mejor = intento;
        descartadas = semilla.descartadas;
      }
    }
  }

  const enCurso = mejor ?? [];
  const superficiePlaca = placaLargo * placaAncho;
  let superficieUtil = 0;

  const placas: PlacaDelPlano[] = enCurso.map((p, i) => {
    const util = p.piezas.reduce((t, x) => t + x.ancho * x.alto, 0);
    superficieUtil += util;
    const aprovechado = util / superficiePlaca;
    return {
      numero: i + 1,
      piezas: p.piezas,
      cortes: p.cortes,
      recortes: aprovechables(p.libres),
      aprovechado,
      seVendeEntera: aprovechado > UMBRAL_PLACA_ENTERA,
    };
  });

  const recorteMayor =
    placas
      .flatMap((p) => p.recortes)
      .sort((a, b) => b.ancho * b.alto - a.ancho * a.alto)[0] ?? null;

  return {
    placaLargo,
    placaAncho,
    anchoSierra,
    placas,
    noEntran,
    totalPiezas: unidades.length,
    aprovechadoTotal:
      placas.length > 0 ? superficieUtil / (superficiePlaca * placas.length) : 0,
    pasadas: placas.reduce((t, p) => t + p.cortes.length, 0),
    recorteMayor,
    placasEnteras: placas.filter((p) => p.seVendeEntera).length,
    pasadasCobrables: placas
      .filter((p) => !p.seVendeEntera)
      .reduce((t, p) => t + p.cortes.length, 0),
    fijadasDescartadas: descartadas,
  };
}

/** Los sobrantes que dan para guardar, del más grande al más chico. */
function aprovechables(libres: Libre[]): Recorte[] {
  return libres
    .filter(
      (l) => l.ancho >= MINIMO_APROVECHABLE && l.alto >= MINIMO_APROVECHABLE,
    )
    .sort((a, b) => b.ancho * b.alto - a.ancho * a.alto);
}

/** La orientación de referencia para ordenar: la más baja de las posibles. */
function referencia(u: Unidad): Orientacion {
  return u.posibles[0]!;
}

/**
 * Menos placas gana. A igual cantidad, gana la que deje el retal más grande:
 * es la que tiene más chance de que ese sobrante sirva para otro trabajo.
 */
function esMejor(candidato: PlacaEnCurso[], actual: PlacaEnCurso[]): boolean {
  if (candidato.length !== actual.length) {
    return candidato.length < actual.length;
  }

  const mayor = (placas: PlacaEnCurso[]) =>
    placas
      .flatMap((p) => aprovechables(p.libres))
      .reduce((t, l) => Math.max(t, l.ancho * l.alto), 0);

  return mayor(candidato) > mayor(actual);
}

/** Acomoda las unidades en el orden que vienen. */
function acomodar(
  unidades: Unidad[],
  placaLargo: number,
  placaAncho: number,
  anchoSierra: number,
  partir: "corto" | "largo",
  /** Placas que ya traen las piezas fijadas a mano. */
  sembradas: PlacaEnCurso[] = [],
): PlacaEnCurso[] {
  const placas: PlacaEnCurso[] = sembradas;

  for (const unidad of unidades) {
    let ubicada = false;

    for (const placa of placas) {
      if (ubicar(placa, unidad, anchoSierra, partir)) {
        ubicada = true;
        break;
      }
    }

    if (!ubicada) {
      const placa: PlacaEnCurso = {
        piezas: [],
        cortes: [],
        libres: [{ x: 0, y: 0, ancho: placaLargo, alto: placaAncho }],
      };
      placas.push(placa);
      // En una placa virgen siempre entra: `orientacionesPosibles` lo garantizó.
      ubicar(placa, unidad, anchoSierra, partir);
    }
  }

  return placas;
}

/**
 * Con qué caras puede apoyar la pieza, de la más baja a la más alta.
 *
 * Si la veta manda no hay elección: la pieza apoya su largo sobre el eje de la
 * veta y girarla sería entregarla con la veta cruzada, que es material tirado.
 * Si no manda, valen las dos y se prueban las dos al colocar: cuál conviene
 * depende del hueco que haya en ese momento, no de la pieza sola.
 *
 * Vacío significa que la pieza no entra ni siquiera en una placa virgen. Es un
 * error de carga y se avisa en vez de perderla en silencio.
 */
function orientacionesPosibles(
  pieza: PiezaAcortar,
  placaLargo: number,
  placaAncho: number,
): Orientacion[] {
  const derecha: Orientacion = {
    ancho: pieza.largoMm,
    alto: pieza.anchoMm,
    girada: false,
  };
  const girada: Orientacion = {
    ancho: pieza.anchoMm,
    alto: pieza.largoMm,
    girada: true,
  };

  const entra = (o: Orientacion) =>
    o.ancho > 0 && o.alto > 0 && o.ancho <= placaLargo && o.alto <= placaAncho;

  if (pieza.respetaVeta === 1) return entra(derecha) ? [derecha] : [];

  // Cuadrada: girarla no cambia nada y duplicar la opción solo hace ruido.
  if (pieza.largoMm === pieza.anchoMm) return entra(derecha) ? [derecha] : [];

  return [derecha, girada].filter(entra).sort((a, b) => a.alto - b.alto);
}

/**
 * Apoya la pieza en el hueco donde mejor calce y parte el resto en dos.
 *
 * **Mejor calce por el lado corto.** Entre todos los huecos donde la pieza
 * entra se elige el que deja menos sobrante en su lado más ajustado. Meterla en
 * el primero que aparezca —que suele ser el más grande— parte el hueco bueno en
 * dos pedazos chicos y después no entra nada.
 */
function ubicar(
  placa: PlacaEnCurso,
  unidad: Unidad,
  anchoSierra: number,
  partir: "corto" | "largo",
): boolean {
  let indiceElegido = -1;
  let libreElegido: Libre | null = null;
  let orientacionElegida: Orientacion | null = null;
  let mejorAjuste = Number.POSITIVE_INFINITY;

  placa.libres.forEach((libre, indice) => {
    for (const orientacion of unidad.posibles) {
      if (orientacion.ancho > libre.ancho || orientacion.alto > libre.alto) {
        continue;
      }
      const ajuste = Math.min(
        libre.ancho - orientacion.ancho,
        libre.alto - orientacion.alto,
      );
      if (ajuste < mejorAjuste) {
        mejorAjuste = ajuste;
        indiceElegido = indice;
        libreElegido = libre;
        orientacionElegida = orientacion;
      }
    }
  });

  if (!libreElegido || !orientacionElegida) return false;

  const libre: Libre = libreElegido;
  const orientacion: Orientacion = orientacionElegida;

  placa.piezas.push({
    x: libre.x,
    y: libre.y,
    ancho: orientacion.ancho,
    alto: orientacion.alto,
    indice: unidad.indice,
    unidad: unidad.unidad,
    etiqueta: unidad.pieza.etiqueta,
    girada: orientacion.girada,
    largoOriginal: unidad.pieza.largoMm,
    anchoOriginal: unidad.pieza.anchoMm,
  });

  placa.libres.splice(indiceElegido, 1);
  partirLibre(placa, libre, orientacion, anchoSierra, partir);
  return true;
}

/**
 * Parte el hueco en dos con un corte recto, que es lo único que sabe hacer la
 * máquina.
 *
 * Hay dos formas de partirlo y cambian bastante el resultado: cortar primero a
 * lo ancho deja una franja de abajo que cruza todo el hueco, y cortar primero a
 * lo alto deja una columna a la derecha que lo cruza entero. La regla clásica
 * —partir de modo que el pedazo grande quede entero— suele ganar, pero no
 * siempre: se prueban las dos y queda la mejor.
 */
function partirLibre(
  placa: PlacaEnCurso,
  libre: Libre,
  orientacion: Orientacion,
  anchoSierra: number,
  partir: "corto" | "largo",
) {
  const sobraDerecha = libre.ancho - orientacion.ancho - anchoSierra;
  const sobraAbajo = libre.alto - orientacion.alto - anchoSierra;

  /*
   * Cuál corte se hace primero decide **hasta dónde llega cada uno**, y eso no
   * es un detalle de dibujo: es la diferencia entre un plano ejecutable y uno
   * que manda la sierra por el medio de una pieza.
   *
   * Si primero se corta a lo ancho, ese corte cruza el hueco entero y el de la
   * derecha queda acotado a la franja de arriba. Si primero se corta a lo alto,
   * pasa al revés. Registrarlos siempre de punta a punta —como se hacía— dibuja
   * un corte que atraviesa lo que la otra mitad ya tiene apoyado.
   */
  const horizontalPrimero =
    partir === "corto" ? sobraAbajo <= sobraDerecha : sobraAbajo > sobraDerecha;

  const xCorte = libre.x + orientacion.ancho + anchoSierra / 2;
  const yCorte = libre.y + orientacion.alto + anchoSierra / 2;

  if (horizontalPrimero) {
    if (sobraAbajo > 0) {
      placa.cortes.push({
        direccion: "horizontal",
        x1: libre.x,
        y1: yCorte,
        x2: libre.x + libre.ancho,
        y2: yCorte,
      });
    }
    if (sobraDerecha > 0) {
      // Acotado a la franja de arriba, que es lo que dejó el corte anterior.
      placa.cortes.push({
        direccion: "vertical",
        x1: xCorte,
        y1: libre.y,
        x2: xCorte,
        y2: libre.y + orientacion.alto,
      });
    }
  } else {
    if (sobraDerecha > 0) {
      placa.cortes.push({
        direccion: "vertical",
        x1: xCorte,
        y1: libre.y,
        x2: xCorte,
        y2: libre.y + libre.alto,
      });
    }
    if (sobraAbajo > 0) {
      // Acotado a la columna de la izquierda.
      placa.cortes.push({
        direccion: "horizontal",
        x1: libre.x,
        y1: yCorte,
        x2: libre.x + orientacion.ancho,
        y2: yCorte,
      });
    }
  }

  if (horizontalPrimero) {
    // El corte de abajo cruza todo el hueco: la franja inferior queda entera.
    if (sobraAbajo > 0) {
      placa.libres.push({
        x: libre.x,
        y: libre.y + orientacion.alto + anchoSierra,
        ancho: libre.ancho,
        alto: sobraAbajo,
      });
    }
    if (sobraDerecha > 0) {
      placa.libres.push({
        x: libre.x + orientacion.ancho + anchoSierra,
        y: libre.y,
        ancho: sobraDerecha,
        alto: orientacion.alto,
      });
    }
  } else {
    // El corte de la derecha cruza todo el hueco: la columna queda entera.
    if (sobraDerecha > 0) {
      placa.libres.push({
        x: libre.x + orientacion.ancho + anchoSierra,
        y: libre.y,
        ancho: sobraDerecha,
        alto: libre.alto,
      });
    }
    if (sobraAbajo > 0) {
      placa.libres.push({
        x: libre.x,
        y: libre.y + orientacion.alto + anchoSierra,
        ancho: orientacion.ancho,
        alto: sobraAbajo,
      });
    }
  }
}

/**
 * Coloca las piezas que alguien movió a mano, antes que nada.
 *
 * Cada una se busca por la **esquina** del hueco donde la soltaron. Si esa
 * esquina ya no existe —porque el despiece cambió y el acomodo es otro— la
 * posición fijada se descarta y la pieza vuelve al automático. No se la acomoda
 * "cerca": mover algo a un lugar parecido sin avisar es peor que devolverlo al
 * cálculo diciéndolo.
 */
function sembrarFijadas(
  aFijar: Unidad[],
  porClave: Map<string, PiezaFijada>,
  placaLargo: number,
  placaAncho: number,
  anchoSierra: number,
  partir: "corto" | "largo",
): {
  placas: PlacaEnCurso[];
  descartadas: PiezaFijada[];
  /** Las que hubo que devolver al acomodo automático. */
  devueltas: Unidad[];
} {
  const placas: PlacaEnCurso[] = [];
  const descartadas: PiezaFijada[] = [];
  const devueltas: Unidad[] = [];

  const nueva = (): PlacaEnCurso => ({
    piezas: [],
    cortes: [],
    libres: [{ x: 0, y: 0, ancho: placaLargo, alto: placaAncho }],
  });

  /*
   * Por placa y, dentro de cada una, las más grandes primero: es el mismo
   * criterio del acomodo automático y por la misma razón —una pieza grande que
   * entra tarde obliga a partir un hueco bueno para nada—.
   */
  const ordenadas = [...aFijar].sort((a, b) => {
    const fa = porClave.get(`${a.indice}/${a.unidad}`)!;
    const fb = porClave.get(`${b.indice}/${b.unidad}`)!;
    const supA = referencia(a).ancho * referencia(a).alto;
    const supB = referencia(b).ancho * referencia(b).alto;
    return fa.placa - fb.placa || supB - supA;
  });

  for (const unidad of ordenadas) {
    const fijada = porClave.get(`${unidad.indice}/${unidad.unidad}`)!;

    while (placas.length < fijada.placa) placas.push(nueva());
    const placa = placas[fijada.placa - 1]!;

    /*
     * Si se impuso también la orientación, se respeta esa sola. Cuando la veta
     * la prohíbe no está entre las posibles, y entonces la decisión se descarta
     * entera: girar una pieza con veta es material tirado, y hacerlo porque
     * alguien arrastró mal sería peor que avisarle.
     */
    const posibles =
      fijada.girada === undefined
        ? unidad.posibles
        : unidad.posibles.filter((o) => o.girada === fijada.girada);

    if (posibles.length === 0) {
      descartadas.push(fijada);
      devueltas.push(unidad);
      continue;
    }

    const entro = ubicar(
      placa,
      { ...unidad, posibles },
      anchoSierra,
      partir,
    );
    if (!entro) {
      descartadas.push(fijada);
      // No se pierde: vuelve al acomodo automático, que la va a poner en otra
      // placa. Descartar la decisión no es descartar la pieza.
      devueltas.push(unidad);
    }
  }

  return { placas, descartadas, devueltas };
}

/**
 * Lee el acomodo manual guardado.
 *
 * Viene de la base como texto y puede estar vacío, mal formado, o traer una
 * lista de otra época. Devolver `[]` ante cualquier duda es lo correcto: el
 * peor caso es que el plano se recalcule solo, que es exactamente lo que hacía
 * antes de que esto existiera.
 */
export function leerAcomodoManual(crudo: string | null): PiezaFijada[] {
  if (!crudo) return [];

  try {
    const leido: unknown = JSON.parse(crudo);
    if (!Array.isArray(leido)) return [];

    return leido.flatMap((x): PiezaFijada[] => {
      if (typeof x !== "object" || x === null) return [];
      const f = x as Record<string, unknown>;
      if (
        !Number.isInteger(f.indice) ||
        !Number.isInteger(f.unidad) ||
        !Number.isInteger(f.placa) ||
        (f.placa as number) < 1
      ) {
        return [];
      }
      return [
        {
          indice: f.indice as number,
          unidad: f.unidad as number,
          placa: f.placa as number,
          ...(typeof f.girada === "boolean" ? { girada: f.girada } : {}),
        },
      ];
    });
  } catch {
    return [];
  }
}
