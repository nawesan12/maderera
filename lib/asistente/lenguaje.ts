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
  { slug: "placas", palabras: ["placa", "placas", "melamina", "melaminico", "mdf", "fenolico", "aglomerado", "terciado"] },
  { slug: "techos", palabras: ["techo", "techos", "tirante", "tirantes", "machimbre", "cabreada"] },
  { slug: "pisos", palabras: ["piso", "pisos", "flotante", "zocalo", "zocalos", "parquet"] },
  { slug: "molduras", palabras: ["moldura", "molduras", "marco", "cornisa", "varilla"] },
  { slug: "ferreteria", palabras: ["tornillo", "tornillos", "bisagra", "bisagras", "clavo", "clavos", "cola", "laca", "herraje", "corredera"] },
  { slug: "decks", palabras: ["deck", "decks", "escalera", "escaleras", "grandis"] },
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

  // Un saludo con algo más atrás no es un saludo: es la pregunta que sigue.
  if (mejor.intencion === "saludo" && consulta.length >= 3) {
    return { intencion: "buscar", puntaje: 1, consulta, medida, cantidad, rubro };
  }

  return { ...mejor, consulta, medida, cantidad, rubro };
}
