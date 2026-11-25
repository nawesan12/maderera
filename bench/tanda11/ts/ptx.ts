/**
 * El programa de corte en PTX, para probar en la seccionadora.
 *
 * **Es experimental y hay que decirlo.** PTX (*Pattern Exchange*) es el
 * formato abierto con que los optimizadores le pasan los patrones a las
 * seccionadoras: lo leen HOMAG/Holzma (vía CADLink) y SCM (vía Maestro
 * Converter Cut, y MaestroActive en la versión 1.14). La especificación es
 * pública —la Interface Guide de Magi-Cut, capítulo «Pattern Exchange File»—
 * y está resumida, con sus fuentes, en `docs/PTX.md`. Lo que **no** está
 * confirmado es que el WinCut del taller lo lea: según las fuentes que se
 * consiguieron, importa «Perfect Cut», y del PTX solo hay menciones de segunda
 * mano. Por eso esto se baja como «prueba» y el operario mira el dibujo en la
 * pantalla de WinCut antes de cortar. Con un programa real copiado de la
 * máquina se ajusta.
 *
 * **Sale del mismo árbol que la hoja de corte** (`secuencia.ts`), que es el
 * plano guillotina con que se cobró el trabajo. PTX describe exactamente eso:
 * cada registro `CUTS` es una tira con su medida **neta** (sin la sierra), su
 * función (1 longitudinal, 2 transversal, 3 tercer nivel…) y cuántas veces se
 * repite; los cortes de un nivel van anidados debajo de la tira de la que
 * salen, en preorden. El disco va una sola vez, en `MATERIALS`, y la sierra lo
 * suma entre tira y tira: la misma convención que la hoja. Lo comprobamos con
 * el ejemplo oficial de Magi-Cut: 5,2 + 4,8 + 572 + 4,8 + 572 + 4,8 + 56,4 da
 * los 1220 de la placa.
 *
 * **Para una PC con Windows XP**: ASCII puro (sin acentos: se transliteran),
 * líneas terminadas en CRLF, sin comillas —una coma en un texto se cambia por
 * un punto, que es lo mismo que hace Magi-Cut al importar— y un nombre de
 * archivo 8.3 en mayúsculas. La especificación no exige 8.3, pero algún
 * controlador acepta solo cinco dígitos de trabajo y CADmatic 3, ocho
 * caracteres sin espacios: lo corto no le hace mal a nadie.
 *
 * Sin base de datos: texto puro, con tests que lo vuelven a leer.
 */

import type { HojaDeCorte, Trozo } from "./secuencia";

/**
 * La versión que se declara en `HEADER`.
 *
 * Las seccionadoras SCM con MaestroActive piden PTX 1.14; Magi-Cut V12 escribe
 * 1.13 y la propia guía dice 1.06 en un lugar y 1.08 en otro. Los campos que
 * se escriben acá son idénticos en 1.08, 1.14 y 1.17 (comparado registro por
 * registro), así que se declara la que pide SCM.
 */
export const VERSION_PTX = "1.14";

/** Lo que hace falta del trabajo, además de la hoja. */
export interface TrabajoParaPtx {
  numero: string;
  cliente: string;
  material: string;
  createdAt: Date;
  /** El despiece, en el mismo orden que usó el plano (`indice`). */
  piezas: {
    largoMm: number;
    anchoMm: number;
    cantidad: number;
    respetaVeta: number;
    etiqueta?: string | null;
  }[];
}

type Partido = Extract<Trozo, { tipo: "partido" }>;

interface RegistroDeCorte {
  funcion: number;
  dimension: number;
  repeticiones: number;
  /** Número de renglón del despiece, o 0 si el corte no deja una pieza. */
  pieza: number;
  cantidadPiezas: number;
  /** Para el orden de corte: el nivel de la máquina y el orden de lista. */
  orden: number;
}

/**
 * Pasa un texto a ASCII imprimible, sin comas ni comillas.
 *
 * «Melamina 18mm, blanca» → «Melamina 18mm. blanca». Los acentos se sacan
 * (é → e) en vez de borrar la letra, y lo que no tiene equivalente se va.
 */
export function textoPtx(texto: string, largoMaximo = 50): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ñ/g, "n")
    .replace(/Ñ/g, "N")
    .replace(/×/g, "x")
    .replace(/,/g, ".")
    .replace(/"/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, largoMaximo);
}

/** Un código: además, sin espacios (la especificación los cambia por «_»). */
function codigoPtx(texto: string, largoMaximo = 50): string {
  return textoPtx(texto, largoMaximo).replace(/ /g, "_").toUpperCase();
}

/**
 * Una medida con un decimal y punto, como la escriben los ejemplos oficiales.
 *
 * Las medidas del plano son enteras más la sierra, que tiene un decimal, así
 * que un decimal es exacto. Nunca «-0.0».
 */
function dim(n: number): string {
  const r = Math.round(n * 10) / 10;
  return (Object.is(r, -0) ? 0 : r).toFixed(1);
}

/** El número del trabajo sin letras: «CRT-460» → «460». */
function numeroDeTrabajo(numero: string): string {
  return numero.replace(/\D/g, "") || "1";
}

/**
 * El nombre del archivo: 8.3, en mayúsculas, del número del trabajo.
 *
 * «CRT-460» → «CRT460.PTX». Si el número fuera largo se queda con los últimos
 * dígitos, que son los que lo distinguen.
 */
export function nombreDeArchivoPtx(numero: string): string {
  const digitos = numeroDeTrabajo(numero);
  const prefijo = (numero.match(/^[A-Za-z]+/)?.[0] ?? "C").toUpperCase().slice(0, 3);
  const cuerpo = `${prefijo}${digitos.slice(-(8 - prefijo.length))}`;
  return `${cuerpo}.PTX`;
}

/** El espesor, si la descripción lo dice («Melamina 18mm blanca» → 18). */
export function espesorDelMaterial(material: string): number | null {
  const m = material.match(/(\d+(?:[.,]\d+)?)\s*mm/i);
  if (!m) return null;
  const n = Number(m[1]!.replace(",", "."));
  return n > 0 && n < 100 ? n : null;
}

/** Espesor que se declara cuando la descripción no lo dice: el de plaza. */
const ESPESOR_POR_OMISION = 18;

function fecha(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/**
 * Arma el archivo PTX de un trabajo.
 *
 * Un trabajo, un material, una medida de placa y un patrón por cada patrón
 * distinto de la hoja (las placas iguales van como `QTY_RUN`).
 */
export function armarPtx(trabajo: TrabajoParaPtx, hoja: HojaDeCorte): string {
  const lineas: string[] = [];
  const conVeta = trabajo.piezas.some((p) => p.respetaVeta === 1);
  const grano = conVeta ? 1 : 0;
  const espesor = espesorDelMaterial(trabajo.material) ?? ESPESOR_POR_OMISION;
  const job = numeroDeTrabajo(trabajo.numero);

  // Cuántas de cada renglón salen de los patrones: lo que no entra no se
  // produce, y el archivo lo dice en QTY_PROD en vez de esconderlo.
  const producidas = new Map<number, number>();
  const patrones = hoja.patrones.map((patron) => {
    const corrida = patron.placas.length;
    const registros = registrosDe(patron.arbol, corrida, hoja.anchoSierra);
    for (const r of registros) {
      if (r.pieza > 0) producidas.set(r.pieza, (producidas.get(r.pieza) ?? 0) + r.cantidadPiezas);
    }
    const nivelInicial = patron.arbol.tipo === "partido" ? patron.arbol.nivel : 1;
    return { patron, corrida, registros, nivelInicial };
  });

  const profundidad = Math.max(
    1,
    ...patrones.flatMap((p) => p.registros.map((r) => (r.funcion < 90 ? r.funcion : r.funcion - 90))),
  );

  // HEADER,VERSION,TITLE,UNITS,ORIGIN,TRIM_TYPE
  // Unidades 0 = milímetros; origen 0 = arriba a la izquierda (solo afecta a
  // VECTORS, que no se escriben); TRIM_TYPE 1, el de los ejemplos oficiales.
  lineas.push(
    ["HEADER", VERSION_PTX, textoPtx(`MJBJ ${trabajo.numero}`, 25), 0, 0, 1].join(","),
  );

  // JOBS,JOB_INDEX,NAME,DESC,ORD_DATE,CUT_DATE,CUSTOMER,STATUS,OPT_PARAM,SAW_PARAM,CUT_TIME,WASTE_PCNT
  const placasTotales = hoja.patrones.reduce((t, p) => t + p.placas.length, 0);
  const superficiePiezas = trabajo.piezas.reduce(
    (t, p, i) => t + p.largoMm * p.anchoMm * (producidas.get(i + 1) ?? 0),
    0,
  );
  const superficiePlacas = placasTotales * hoja.placaLargo * hoja.placaAncho;
  const desperdicio =
    superficiePlacas > 0 ? ((superficiePlacas - superficiePiezas) / superficiePlacas) * 100 : 0;
  lineas.push(
    [
      "JOBS",
      1,
      job,
      textoPtx(`${trabajo.numero} ${trabajo.material}`),
      fecha(trabajo.createdAt),
      "",
      textoPtx(trabajo.cliente, 100),
      1, // optimizado
      "",
      "",
      0,
      desperdicio.toFixed(2),
    ].join(","),
  );

  // PARTS_REQ,JOB,PART_INDEX,CODE,MAT_INDEX,LENGTH,WIDTH,QTY_REQ,QTY_OVER,QTY_UNDER,GRAIN,QTY_PROD,
  //   UNDER_PROD_ERROR,UNDER_PROD_ALLOWED,UNDER_PROD_PLUSPART
  trabajo.piezas.forEach((p, i) => {
    const renglon = i + 1;
    const codigo = codigoPtx(p.etiqueta ? `P${renglon} ${p.etiqueta}` : `P${renglon}`);
    lineas.push(
      [
        "PARTS_REQ",
        1,
        renglon,
        codigo,
        1,
        dim(p.largoMm),
        dim(p.anchoMm),
        p.cantidad,
        0,
        0,
        // 1 = la veta corre a lo largo y no se gira; 0 = se puede girar.
        p.respetaVeta === 1 ? 1 : 0,
        producidas.get(renglon) ?? 0,
        Math.max(0, p.cantidad - (producidas.get(renglon) ?? 0)),
        0,
        0,
      ].join(","),
    );
  });

  // BOARDS,JOB,BRD_INDEX,CODE,MAT_INDEX,LENGTH,WIDTH,QTY_STOCK,QTY_USED,COST,STK_FLAG,
  //   INFORMATION,MAT_PARAM,GRAIN,TYPE,BIN,SUPPLIER
  const codigoMaterial = codigoPtx(trabajo.material, 50) || "MATERIAL";
  lineas.push(
    [
      "BOARDS",
      1,
      1,
      codigoPtx(`${codigoMaterial.slice(0, 40)}/01`),
      1,
      dim(hoja.placaLargo),
      dim(hoja.placaAncho),
      Math.max(placasTotales, 1),
      placasTotales,
      "0.000",
      0,
      "",
      "",
      grano,
      0, // placa de stock, no retal
      "",
      "",
    ].join(","),
  );

  // MATERIALS,JOB,MAT_INDEX,CODE,DESC,THICK,BOOK,KERF_RIP,KERF_XCT,TRIM_FRIP,TRIM_VRIP,TRIM_FXCT,
  //   TRIM_VXCT,TRIM_HEAD,TRIM_FRCT,TRIM_VRCT,RULE1,RULE2,RULE3,RULE4,MAT_PARAM,GRAIN,PICTURE,DENSITY
  // Los refilados en 0 y no vacíos: vacío quiere decir «usá lo que tengas
  // configurado», y el plano no lleva refilado. BOOK 1: una placa por vez.
  lineas.push(
    [
      "MATERIALS",
      1,
      1,
      codigoMaterial,
      textoPtx(trabajo.material),
      dim(espesor),
      1,
      dim(hoja.anchoSierra),
      dim(hoja.anchoSierra),
      "0.0",
      "0.0",
      "0.0",
      "0.0",
      "0.0",
      "0.0",
      "0.0",
      Math.min(9, profundidad), // RULE1: hasta qué nivel anida
      0, // RULE2: sin cortes de cabeza
      patrones.some((p) => p.nivelInicial === 2) ? 1 : 0, // RULE3: girar la placa
      0,
      "",
      grano,
      "",
      "",
    ].join(","),
  );

  // PATTERNS,JOB,PTN_INDEX,BRD_INDEX,TYPE,QTY_RUN,QTY_CYCLES,MAX_BOOK,PICTURE,CYCLE_TIME,TOTAL_TIME
  // y debajo de cada uno, sus CUTS:
  // CUTS,JOB,PTN_INDEX,CUT_INDEX,SEQUENCE,FUNCTION,DIMENSION,QTY_RPT,PART_INDEX,QTY_PARTS,COMMENT
  patrones.forEach(({ corrida, registros, nivelInicial }, i) => {
    const ptn = i + 1;
    // 0 = primero a lo largo; 1 = girar la placa antes, cuando el patrón
    // arranca con los cortes de través.
    const tipo = nivelInicial === 2 ? 1 : 0;
    lineas.push(["PATTERNS", 1, ptn, 1, tipo, corrida, corrida, 1, "", 0, 0].join(","));

    const secuencias = secuenciaDeCorte(registros);
    registros.forEach((r, k) => {
      lineas.push(
        [
          "CUTS",
          1,
          ptn,
          k + 1,
          secuencias[k],
          r.funcion,
          dim(r.dimension),
          r.repeticiones,
          r.pieza,
          r.cantidadPiezas,
        ].join(","),
      );
    });
  });

  return lineas.map((l) => `${l}\r\n`).join("");
}

/**
 * Los registros `CUTS` de un patrón, en preorden: cada tira y, debajo, lo que
 * sale de ella.
 *
 * Las reglas son las de la especificación:
 *
 * - `DIMENSION` es la medida neta de la tira o la pieza; la sierra la pone la
 *   máquina entre una y otra (cada repetición lleva un corte detrás).
 * - Piezas seguidas iguales van en un registro con `QTY_RPT`.
 * - Si la última tira llega justo al borde no lleva corte: va en un registro
 *   aparte con `QTY_RPT` 0 y la medida sin cambiar («encaje exacto»).
 * - Lo que sobra al final va como desperdicio de esa fase (91, 92, 93…) con
 *   `QTY_RPT` 0. Si lo que quedaba era más fino que el disco, la medida da
 *   cero o negativa, como en los archivos que exporta Magi-Cut.
 * - `QTY_PARTS` es el total de todas las placas del patrón.
 * - Si un nivel no lleva cortes —la tira pasa entera al siguiente— va un
 *   registro de la medida completa con `QTY_RPT` 0, para que el anidado no
 *   salte de la función 1 a la 3.
 */
function registrosDe(arbol: Trozo, corrida: number, sierra: number): RegistroDeCorte[] {
  const registros: RegistroDeCorte[] = [];
  if (arbol.tipo === "sobrante") return registros;

  if (arbol.tipo === "pieza") {
    // La placa entera es la pieza: un registro sin corte.
    registros.push({
      funcion: 1,
      dimension: arbol.rect.alto,
      repeticiones: 0,
      pieza: arbol.pieza.indice + 1,
      cantidadPiezas: corrida,
      orden: 1,
    });
    return registros;
  }

  // Si el patrón arranca de través, en el archivo es «girar la placa» y los
  // niveles corren uno: el transversal pasa a ser la función 1.
  const desplazamiento = arbol.nivel - 1;
  const funcionDe = (nivel: number) => nivel - desplazamiento;
  const medidaEn = (t: Trozo, eje: "x" | "y") => (eje === "y" ? t.rect.alto : t.rect.ancho);

  const recorrer = (trozo: Partido, nivelPadre: number) => {
    // Los niveles que el trozo salteó: una tira de la medida completa, sin corte.
    for (let nivel = nivelPadre + 1; nivel < trozo.nivel; nivel++) {
      const eje = nivel % 2 === 1 ? "y" : "x";
      registros.push({
        funcion: funcionDe(nivel),
        dimension: medidaEn(trozo, eje),
        repeticiones: 0,
        pieza: 0,
        cantidadPiezas: 0,
        orden: funcionDe(nivel),
      });
    }

    const f = funcionDe(trozo.nivel);
    const hijos = trozo.hijos;

    let i = 0;
    while (i < hijos.length) {
      const hijo = hijos[i]!;
      const medida = medidaEn(hijo, trozo.eje);
      const esUltimo = (k: number) => k === hijos.length - 1;

      if (hijo.tipo === "pieza") {
        // Las piezas iguales seguidas, juntas.
        let j = i;
        while (
          j < hijos.length &&
          hijos[j]!.tipo === "pieza" &&
          (hijos[j] as Extract<Trozo, { tipo: "pieza" }>).pieza.indice === hijo.pieza.indice &&
          Math.abs(medidaEn(hijos[j]!, trozo.eje) - medida) < 0.001 &&
          Math.abs(medidaEn(hijos[j]!, trozo.eje === "y" ? "x" : "y") - medidaEn(hijo, trozo.eje === "y" ? "x" : "y")) < 0.001
        ) {
          j++;
        }
        let cuantas = j - i;
        const ultimaSinCorte = esUltimo(j - 1) && trozo.ultimaSinCorte;
        if (ultimaSinCorte) cuantas--;
        if (cuantas > 0) {
          registros.push({
            funcion: f,
            dimension: medida,
            repeticiones: cuantas,
            pieza: hijo.pieza.indice + 1,
            cantidadPiezas: cuantas * corrida,
            orden: f,
          });
        }
        if (ultimaSinCorte) {
          registros.push({
            funcion: f,
            dimension: medida,
            repeticiones: 0,
            pieza: hijo.pieza.indice + 1,
            cantidadPiezas: corrida,
            orden: f,
          });
        }
        i = j;
        continue;
      }

      if (hijo.tipo === "partido") {
        // Una tira que se sigue cortando: su registro y, debajo, lo suyo.
        registros.push({
          funcion: f,
          dimension: medida,
          repeticiones: esUltimo(i) && trozo.ultimaSinCorte ? 0 : 1,
          pieza: 0,
          cantidadPiezas: 0,
          orden: f,
        });
        recorrer(hijo, trozo.nivel);
      }
      i++;
    }

    // Lo que queda después del último corte.
    if (!trozo.ultimaSinCorte) {
      const total = medidaEn(trozo, trozo.eje);
      const usado =
        hijos.reduce((t, h) => t + medidaEn(h, trozo.eje), 0) + hijos.length * sierra;
      registros.push({
        funcion: 90 + f,
        dimension: Math.round((total - usado) * 1000) / 1000,
        repeticiones: 0,
        pieza: 0,
        cantidadPiezas: 0,
        orden: f,
      });
    }
  };

  recorrer(arbol, arbol.nivel - 1);
  return registros;
}

/**
 * El orden de corte (`SEQUENCE`): primero todo el nivel 1, después el 2…, y
 * adentro de cada nivel en el orden de la lista. Es el de la hoja impresa.
 *
 * Avanza de a `QTY_RPT`, como pide la especificación, y los registros sin
 * pasada propia (`QTY_RPT` 0) llevan 0.
 */
function secuenciaDeCorte(registros: RegistroDeCorte[]): number[] {
  const orden = registros
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.repeticiones > 0)
    .sort((a, b) => a.r.orden - b.r.orden || a.i - b.i);

  const resultado = registros.map(() => 0);
  let siguiente = 1;
  for (const { r, i } of orden) {
    resultado[i] = siguiente;
    siguiente += r.repeticiones;
  }
  return resultado;
}

/** Un registro leído: el nombre y sus campos, sin espacios alrededor. */
export interface RegistroPtx {
  tipo: string;
  campos: string[];
}

/**
 * Lee un PTX: una línea por registro, campos separados por coma, comillas
 * optativas y espacios iniciales ignorados.
 *
 * Existe para los tests —que vuelven a leer lo que se escribe— y para el día
 * en que haya un programa real de la máquina para comparar.
 */
export function leerPtx(texto: string): RegistroPtx[] {
  return texto
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((linea) => {
      const campos: string[] = [];
      let actual = "";
      let entreComillas = false;
      for (let i = 0; i < linea.length; i++) {
        const c = linea[i]!;
        if (c === '"') {
          if (entreComillas && linea[i + 1] === '"') {
            actual += '"';
            i++;
          } else {
            entreComillas = !entreComillas;
          }
        } else if (c === "," && !entreComillas) {
          campos.push(actual.trim());
          actual = "";
        } else {
          actual += c;
        }
      }
      campos.push(actual.trim());
      const [tipo, ...resto] = campos;
      return { tipo: tipo!, campos: resto };
    });
}
