/**
 * Qué quiso decir quien escribió.
 *
 * Es lo que hace que el asistente entienda «tenés fenólico de 18?» sin un
 * modelo de lenguaje detrás. La idea es vieja y funciona bien cuando el dominio
 * es chico y conocido: se normaliza el texto, se lo compara contra las palabras
 * que de verdad usa la gente de una maderera, y se le sacan los datos concretos
 * —una medida, una cantidad, un rubro— que después van a la consulta real.
 *
 * **Dónde está el límite, dicho de frente.** Esto no entiende: reconoce. Con
 * una pregunta que no se parezca a nada de lo previsto, la salida es
 * `sin_idea`, y ahí el asistente hace lo único honesto, que es buscar en el
 * catálogo y, si no encuentra, ofrecer una persona. Nunca inventa una
 * respuesta, que es exactamente el riesgo que se evitó al no usar un modelo.
 *
 * Todo acá es puro y sin base de datos: se prueba entero con vitest.
 */

export type Intencion =
  | "saludo"
  | "buscar"
  | "precio"
  | "stock"
  | "envios"
  | "horarios"
  | "pagos"
  | "cortes"
  | "cuenta"
  | "calcular"
  | "armar_corte"
  | "moldava"
  | "documentacion"
  | "devoluciones"
  | "acopio"
  | "factura"
  | "eventos"
  | "persona"
  | "gracias"
  | "sin_idea";

export interface Medida {
  /** Espesor en milímetros: el "18" de «fenólico de 18». */
  espesorMm?: number;
  /** Largo y ancho, cuando escriben algo como «2440 x 1220». */
  largoMm?: number;
  anchoMm?: number;
}

export interface Entendido {
  intencion: Intencion;
  /** Qué tan seguro está. Cero es no haber reconocido nada. */
  puntaje: number;
  /** El texto limpio que conviene mandar a la búsqueda del catálogo. */
  consulta: string;
  medida: Medida;
  /** Metros cuadrados o lineales, si los dijeron. */
  cantidad?: { valor: number; unidad: "m2" | "m" | "unidades" };
  /** Rubro nombrado, si se reconoce alguno. */
  rubro?: string;
  /** Las piezas de un corte, si escribieron un despiece. */
  despiece?: Despiece;
}

export interface PiezaDelTexto {
  largoMm: number;
  anchoMm: number;
  cantidad: number;
  cantoLargo: number;
  cantoAncho: number;
}

/** Un despiece escrito con palabras: «4 de 600x400 en melamina blanca con canto». */
export interface Despiece {
  piezas: PiezaDelTexto[];
  /** Lo que dijeron del material, para elegir la placa: «melamina blanca». */
  material: string;
}

/**
 * Minúsculas y sin acentos.
 *
 * Es el equivalente en TypeScript de lo que hace `f_unaccent` en la base, y
 * está para lo mismo: nadie escribe los acentos cuando busca rápido.
 */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s.,x/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/*
 * Las palabras de cada intención, en el orden en que se prueban.
 *
 * Están escritas como las dice la gente, con los modismos incluidos: «hacen
 * envio», «mandan a domicilio», «me lo cortan», «fiado». Una lista escrita
 * pensando en cómo se dice en el diccionario reconoce la mitad.
 */
const SENALES: { intencion: Intencion; palabras: string[]; peso?: number }[] = [
  {
    intencion: "saludo",
    palabras: ["hola", "buenas", "buen dia", "buenas tardes", "que tal", "hey"],
  },
  {
    intencion: "gracias",
    palabras: ["gracias", "genial", "perfecto", "barbaro", "buenisimo", "dale gracias"],
  },
  {
    intencion: "envios",
    palabras: [
      "envio", "envios", "envian", "mandan", "entrega", "entregan",
      "domicilio", "flete", "reparto", "llevan", "traen",
    ],
  },
  {
    intencion: "horarios",
    palabras: [
      "horario", "horarios", "abren", "cierran", "abierto", "atienden",
      "direccion", "donde estan", "donde queda", "sucursal", "sucursales",
      "local", "locales", "telefono",
    ],
  },
  {
    intencion: "pagos",
    palabras: [
      "pago", "pagar", "pagos", "tarjeta", "credito", "debito", "cuotas",
      "transferencia", "efectivo", "mercado pago", "financiacion",
    ],
  },
  {
    intencion: "cortes",
    palabras: [
      "corte", "cortes", "cortar", "cortan", "a medida", "despiece",
      "aserradero", "me lo cortan",
    ],
  },
  {
    intencion: "cuenta",
    palabras: [
      "cuenta corriente", "cuenta", "fiado", "credito comercial",
      "profesional", "mayorista", "descuento por cantidad", "revendedor",
      "carpintero", "constructor",
    ],
  },
  {
    intencion: "calcular",
    palabras: [
      "cuanto necesito", "cuanto me sale", "calcular", "calculo", "cuantas placas",
      "cuanto material", "cuantos metros", "me alcanza", "rinde",
    ],
  },
  {
    intencion: "moldava",
    palabras: ["moldava", "linea propia", "finger joint", "fingerjoint"],
    peso: 2,
  },
  {
    intencion: "documentacion",
    palabras: ["ficha tecnica", "fichas tecnicas", "tabla de carga", "documentacion", "instructivo", "pliego"],
  },
  {
    intencion: "devoluciones",
    palabras: ["devolucion", "devolver", "cambio", "cambiar", "garantia", "vino fallado", "vino mal"],
  },
  {
    intencion: "acopio",
    palabras: ["acopio", "acopiar", "dejar guardado", "retirar despues", "retiro en partes", "de a poco"],
  },
  {
    intencion: "factura",
    palabras: ["factura a", "factura b", "factura", "facturan", "cuit", "responsable inscripto", "monotributo"],
  },
  {
    intencion: "eventos",
    palabras: ["capacitacion", "capacitaciones", "curso", "cursos", "charla", "charlas", "evento", "eventos", "taller"],
  },
  {
    intencion: "persona",
    palabras: [
      "hablar con alguien", "una persona", "vendedor", "atienden", "llamar",
      "whatsapp", "asesor", "humano",
    ],
  },
  {
    intencion: "stock",
    palabras: ["tenes", "tienen", "hay stock", "stock", "disponible", "queda", "quedan"],
  },
  {
    intencion: "precio",
    palabras: ["precio", "cuanto sale", "cuanto vale", "cuanto cuesta", "vale", "sale"],
  },
  {
    intencion: "buscar",
    palabras: ["busco", "necesito", "quiero", "estoy buscando", "me sirve", "para hacer"],
  },
];

/**
 * Rubros por como los nombra la gente, no por como se llaman en el catálogo.
 *
 * Nadie escribe «construcción en seco»: escribe «durlock». El slug es el del
 * catálogo sembrado; si mañana cambian, esto queda apuntando a nada y la
 * búsqueda por texto lo cubre igual.
 */
const RUBROS: { slug: string; palabras: string[] }[] = [
  { slug: "placas", palabras: ["placa", "placas", "melamina", "melaminico", "mdf", "fenolico", "aglomerado", "terciado", "terciados", "chapadur", "enchapado", "enchapados", "ranurado", "ranurados", "osb", "fibrofacil", "tablero", "tableros"] },
  { slug: "techos", palabras: ["techo", "techos", "tirante", "tirantes", "machimbre", "cabreada"] },
  { slug: "pisos", palabras: ["piso", "pisos", "flotante", "zocalo", "zocalos", "parquet"] },
  { slug: "molduras", palabras: ["moldura", "molduras", "marco", "cornisa", "varilla"] },
  { slug: "ferreteria", palabras: ["tornillo", "tornillos", "bisagra", "bisagras", "clavo", "clavos", "cola", "laca", "herraje", "corredera"] },
  // El slug del catálogo es `decks-y-escaleras`; decía `decks` y no apuntaba a
  // ninguna categoría, así que el atajo nunca funcionó.
  { slug: "decks-y-escaleras", palabras: ["deck", "decks", "escalera", "escaleras", "grandis"] },
  { slug: "construccion-en-seco", palabras: ["durlock", "yeso", "montante", "solera", "lana de vidrio", "construccion en seco"] },
  { slug: "cubiertas", palabras: ["chapa", "chapas", "cubierta", "cubiertas", "curvin", "teja", "tejas"] },
];

/** Palabras que no aportan nada a la búsqueda del catálogo. */
const VACIAS = new Set([
  "hola", "buenas", "gracias", "por", "favor", "quiero", "queria", "necesito",
  "busco", "buscando", "estoy", "tenes", "tienen", "hay", "el", "la", "los",
  "las", "un", "una", "unos", "unas", "de", "del", "para", "con", "y", "o",
  "que", "cual", "cuanto", "cuanta", "sale", "vale", "cuesta", "precio",
  "me", "mi", "es", "en", "a", "al", "se", "su", "algo", "alguna", "algun",
  "sirve", "puede", "podrian", "ustedes", "tengo", "hacer", "haria", "mm",
  "tardes", "dia", "dias", "noches", "che", "ah", "eh", "ok", "si", "no",
]);

/** El espesor en milímetros, si lo dijeron. */
function leerMedida(texto: string): Medida {
  const medida: Medida = {};

  // «2440 x 1220» o «2440x1220»
  const porPor = texto.match(/(\d{2,4})\s*[x×]\s*(\d{2,4})/);
  if (porPor) {
    medida.largoMm = Number(porPor[1]);
    medida.anchoMm = Number(porPor[2]);
  }

  // «18mm», «de 18», «espesor 18». Se acota a lo que es un espesor creíble
  // para no confundir el «2600» de una medida con un grosor de placa.
  const conMm = texto.match(/(\d{1,3})\s*mm\b/);
  if (conMm) {
    medida.espesorMm = Number(conMm[1]);
    return medida;
  }

  const suelto = texto.match(/\bde\s+(\d{1,2})\b/);
  if (suelto) {
    const valor = Number(suelto[1]);
    if (valor >= 3 && valor <= 50) medida.espesorMm = valor;
  }

  return medida;
}

function leerCantidad(texto: string): Entendido["cantidad"] {
  const m2 = texto.match(/(\d+(?:[.,]\d+)?)\s*(?:m2|m²|metros? cuadrados?)/);
  if (m2) return { valor: Number(m2[1].replace(",", ".")), unidad: "m2" };

  const metros = texto.match(/(\d+(?:[.,]\d+)?)\s*(?:m|metros?|ml)\b/);
  if (metros) return { valor: Number(metros[1].replace(",", ".")), unidad: "m" };

  return undefined;
}

/**
 * El rubro que nombraron.
 *
 * Gana el que aparece **primero en la frase**, no el primero de la lista. En
 * «busco chapa para el techo» hay dos rubros nombrados —chapa es cubiertas,
 * techo es techos— y el que importa es el sustantivo con el que arrancaron: se
 * viene a comprar una chapa, el techo es para qué. Si empatan, gana la palabra
 * más larga, que es la más específica.
 */
function leerRubro(texto: string): string | undefined {
  let mejor: { slug: string; donde: number; largo: number } | null = null;

  for (const rubro of RUBROS) {
    for (const palabra of rubro.palabras) {
      const donde = texto.indexOf(palabra);
      if (donde === -1) continue;

      const gana =
        !mejor ||
        donde < mejor.donde ||
        (donde === mejor.donde && palabra.length > mejor.largo);

      if (gana) mejor = { slug: rubro.slug, donde, largo: palabra.length };
    }
  }

  return mejor?.slug;
}

/**
 * Lo que queda del texto cuando se le sacan las muletillas y los números.
 *
 * **Los números se van, y es la parte que importa.** La búsqueda del catálogo
 * mira el nombre, la descripción, la marca y el rubro del producto, no las
 * medidas de sus variantes: buscar «fenolico 18» no encuentra nada, porque el
 * 18 no está en ninguna de esas columnas. El nombre va a la consulta y la
 * medida se aplica después, como filtro sobre lo que volvió.
 *
 * Costó una prueba contra producción darse cuenta: el asistente contestaba
 * "no lo encontré" y abajo mostraba el fenólico de 18 mm.
 */
export function consultaLimpia(texto: string): string {
  return normalizar(texto)
    // La puntuación se va acá y no en `normalizar`, que tiene que conservar la
    // coma y la equis para poder leer «2440x1220» y «1,5 m».
    .replace(/[.,;:!?]/g, " ")
    .split(/\s+/)
    .filter(
      (palabra) =>
        palabra.length > 1 &&
        !VACIAS.has(palabra) &&
        // "18", "18mm", "2440x1220": son medidas, no nombres.
        !/^\d+(mm|cm|m)?$/.test(palabra) &&
        !/^\d+[x×]\d+$/.test(palabra),
    )
    .slice(0, 6)
    .join(" ")
    .trim();
}

export function entender(textoOriginal: string): Entendido {
  const texto = normalizar(textoOriginal);

  // Un despiece le gana a todo: si escribieron piezas, quieren el corte.
  const despiece = leerDespiece(texto);
  if (despiece) {
    return {
      intencion: "armar_corte",
      puntaje: 5,
      consulta: consultaLimpia(textoOriginal),
      medida: {},
      rubro: "placas",
      despiece,
    };
  }

  const medida = leerMedida(texto);
  const cantidad = leerCantidad(texto);
  const rubro = leerRubro(texto);
  const consulta = consultaLimpia(textoOriginal);

  let mejor: { intencion: Intencion; puntaje: number } = {
    intencion: "sin_idea",
    puntaje: 0,
  };

  /** Lo que se reconoció, para poder desempatar con criterio. */
  const reconocidas = new Map<Intencion, number>();

  for (const senal of SENALES) {
    for (const palabra of senal.palabras) {
      if (!texto.includes(palabra)) continue;

      // Las frases valen más que las palabras sueltas: «cuenta corriente» es
      // más específico que «cuenta», y «hay stock» que «hay».
      const puntaje = (senal.peso ?? 1) * (palabra.includes(" ") ? 3 : 2);

      reconocidas.set(
        senal.intencion,
        Math.max(reconocidas.get(senal.intencion) ?? 0, puntaje),
      );

      if (puntaje > mejor.puntaje) {
        mejor = { intencion: senal.intencion, puntaje };
      }
    }
  }

  /*
   * Preguntar por un servicio le gana a preguntar un precio.
   *
   * «cuánto sale el flete» tiene las dos cosas: «cuánto sale» es más larga y
   * gana por puntaje, pero la respuesta correcta son las zonas de envío y no
   * una lista de productos. Vale mientras no hayan nombrado un rubro: si
   * dicen «cuánto sale el fenólico», ahí sí quieren el producto.
   */
  const SERVICIOS: Intencion[] = [
    "envios", "horarios", "pagos", "cortes", "cuenta", "persona", "calcular",
    "documentacion", "devoluciones", "acopio", "factura", "eventos",
  ];

  if (!rubro && (mejor.intencion === "precio" || mejor.intencion === "stock")) {
    const servicio = SERVICIOS.map((i) => ({ i, p: reconocidas.get(i) ?? 0 }))
      .filter((s) => s.p > 0)
      .sort((a, b) => b.p - a.p)[0];

    if (servicio) mejor = { intencion: servicio.i, puntaje: servicio.p };
  }

  /*
   * Nombrar un producto gana sobre casi todo lo demás.
   *
   * «cuánto sale el fenólico de 18» tiene la palabra «precio» y también un
   * producto; lo que hay que hacer es buscar el producto y mostrar el precio,
   * no recitar la lista de formas de pago. Lo mismo con «tenés melamina»: la
   * intención declarada es stock, pero la respuesta útil es el producto.
   */
  const nombraProducto = Boolean(rubro) || consulta.length >= 3;
  const preguntaDeProducto =
    mejor.intencion === "precio" ||
    mejor.intencion === "stock" ||
    mejor.intencion === "buscar" ||
    mejor.intencion === "sin_idea";

  if (nombraProducto && preguntaDeProducto) {
    return {
      intencion: "buscar",
      puntaje: Math.max(mejor.puntaje, rubro ? 3 : 1),
      consulta,
      medida,
      cantidad,
      rubro,
    };
  }

  // Moldava es una marca y también un rubro: preguntar por ella no es buscar
  // un producto suelto sino conocer la línea.
  if (reconocidas.has("moldava") && !leerMedida(texto).espesorMm) {
    return { intencion: "moldava", puntaje: reconocidas.get("moldava")!, consulta, medida, cantidad, rubro };
  }

  // Un saludo con algo más atrás no es un saludo: es la pregunta que sigue.
  if (mejor.intencion === "saludo" && consulta.length >= 3) {
    return { intencion: "buscar", puntaje: 1, consulta, medida, cantidad, rubro };
  }

  return { ...mejor, consulta, medida, cantidad, rubro };
}

/**
 * Las piezas de un corte escritas con palabras (notas del 9/11/2026: el
 * asistente arma el corte desde el texto).
 *
 * Reconoce «4 de 600x400», «4 piezas de 600 x 400» y «600x400 x 4», varias
 * en la misma frase. Para no confundir un despiece con
 * la medida de una placa entera («fenólico 2440x1220»), hace falta una
 * cantidad, la palabra corte/cortar/despiece/piezas, o más de una medida.
 * «Con canto» pone canto en los dos largos; «canto en todo» o «en los 4
 * lados», en los cuatro.
 */
export function leerDespiece(texto: string): Despiece | null {
  const t = normalizar(texto);
  const patron = /(?:\b(\d{1,3})\s+(?:(?:piezas?|unidades|u)\s+)?(?:de\s+)?)?\b(\d{2,4})\s*x\s*(\d{2,4})\b(?:\s*(?:mm)?\s*x\s*(\d{1,3})\b(?!\s*x))?/g;
  const encontradas: { largo: number; ancho: number; cantidad: number | null }[] = [];
  for (const m of t.matchAll(patron)) {
    const largo = Number(m[2]);
    const ancho = Number(m[3]);
    if (largo < 20 || ancho < 20 || largo > 3000 || ancho > 3000) continue;
    const cantidad = Number(m[1] ?? m[4] ?? NaN);
    encontradas.push({ largo, ancho, cantidad: Number.isFinite(cantidad) && cantidad > 0 ? cantidad : null });
  }
  if (encontradas.length === 0) return null;

  const pideCorte = /\b(corte|cortes|cortar|cortame|cortan|despiece|piezas?)\b/.test(t);
  const conCantidad = encontradas.some((e) => e.cantidad !== null);
  if (!pideCorte && !conCantidad && encontradas.length < 2) return null;

  const todoElCanto = /canto (en )?(todo|todos|los 4|los cuatro|4 lados|cuatro lados)/.test(t);
  const conCanto = todoElCanto || /\b(con canto|con tapacanto|tapacanto|canteado)\b/.test(t);
  const sinCanto = /\bsin (tapa)?canto\b/.test(t);

  const piezas = encontradas.map((e) => ({
    largoMm: Math.max(e.largo, e.ancho),
    anchoMm: Math.min(e.largo, e.ancho),
    cantidad: e.cantidad ?? 1,
    cantoLargo: conCanto && !sinCanto ? 2 : 0,
    cantoAncho: todoElCanto && !sinCanto ? 2 : 0,
  }));

  // El material: lo que queda sin números, cantidades ni las palabras del corte.
  const material = consultaLimpia(t)
    .split(" ")
    .filter((p) => !/^(piezas?|corte|cortes|cortar|cortame|cortan|despiece|canto|tapacanto|todo|todos|lados|cuatro|unidades|sin|placa|placas|en)$/.test(p))
    .join(" ")
    .trim();

  return { piezas, material };
}

/**
 * La pregunta que sigue a otra: «¿y en 18?» después de hablar de MDF.
 *
 * Si el texto nuevo no nombra ningún producto pero trae una medida o un
 * espesor, se completa con la consulta anterior. Si nombra algo, va solo.
 */
export function conContexto(texto: string, anterior: string | null): string {
  if (!anterior) return texto;
  const t = normalizar(texto);
  const nombraAlgo = consultaLimpia(texto).replace(/\b(y|en|de|con)\b/g, "").trim().length >= 3;
  const traeMedida = /\d/.test(t);
  const sigue = /^(y|y en|y de|y con|en|de|con|otra|otro|la de|el de)\b/.test(t);
  if (!nombraAlgo && (traeMedida || sigue)) return `${anterior} ${texto}`.trim();
  return texto;
}

/** El enlace al cortador con el despiece cargado (`app/(public)/corte`). */
export function enlaceDelDespiece(d: Despiece): string {
  const piezas = d.piezas
    .map((p) => `${p.largoMm}x${p.anchoMm}x${p.cantidad}${p.cantoLargo || p.cantoAncho ? `c${p.cantoLargo}${p.cantoAncho}` : ""}`)
    .join("_");
  const parametros = new URLSearchParams({ piezas });
  if (d.material) parametros.set("material", d.material);
  return `/corte#${parametros.toString()}`;
}
