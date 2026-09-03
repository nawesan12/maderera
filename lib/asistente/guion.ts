/**
 * El guion del asistente del sitio.
 *
 * **Sin inteligencia artificial, y no por limitación sino por decisión.** Lo
 * que la gente pregunta en una maderera es un conjunto chico y conocido: si
 * cortan a medida, si hacen envíos, cuánto sale el flete, qué placa usar para
 * un mueble, cuánto machimbre entra en un techo. Todo eso tiene respuesta
 * exacta, y una respuesta exacta escrita por el negocio es mejor que una
 * generada: no inventa un precio, no promete un plazo que nadie prometió, y se
 * corrige editando un renglón en vez de rezándole a un modelo.
 *
 * Lo que sí tiene de vivo: los productos y los precios salen del catálogo real
 * —con la lista que le toca a quien está mirando—, y los horarios, teléfonos y
 * costos de envío salen de las mismas tablas que el resto del sitio. El guion
 * dice *qué se pregunta*; los datos los pone el sistema.
 *
 * Es un dato y no código: se lee de un vistazo, se le agrega una rama sin tocar
 * la pantalla, y se puede probar sin levantar un navegador.
 */

/** Qué hace un paso además de mostrar texto. */
export type AccionDelPaso =
  /** Muestra los productos de una categoría del catálogo. */
  | { tipo: "categoria"; slug: string }
  /** Deja escribir y busca en el catálogo. */
  | { tipo: "buscar" }
  /** Abre una de las calculadoras que ya existen en el sitio. */
  | { tipo: "calculadora"; cual: "techos" | "placas" | "pisos" | "decks" }
  /** Manda a una página del sitio. */
  | { tipo: "ir"; ruta: string }
  /** Pasa la conversación a una persona, con el texto ya escrito. */
  | { tipo: "whatsapp"; mensaje: string }
  /** Un dato que el servidor completa: horarios, envíos, sucursales. */
  | { tipo: "dato"; cual: "sucursales" | "envios" | "pagos" };

export interface OpcionDelPaso {
  texto: string;
  /** A qué paso va. */
  va: string;
}

export interface PasoDelGuion {
  id: string;
  /** Lo que dice el asistente al llegar acá. */
  mensaje: string;
  /** Lo que puede hacer además de hablar. */
  accion?: AccionDelPaso;
  /** Los botones. Vacío significa que el paso termina la rama. */
  opciones: OpcionDelPaso[];
}

/** El paso donde arranca todo. */
export const PASO_INICIAL = "inicio";

/** Vuelve al principio; se agrega solo a los pasos que no lo tengan. */
const VOLVER: OpcionDelPaso = { texto: "Volver al inicio", va: PASO_INICIAL };

const PASOS: PasoDelGuion[] = [
  {
    id: "inicio",
    mensaje:
      "¡Hola! Te ayudo a encontrar lo que buscás. ¿Con qué te doy una mano?",
    opciones: [
      { texto: "Busco un producto", va: "que-busca" },
      { texto: "No sé cuánto material necesito", va: "calcular" },
      { texto: "Tengo una duda", va: "dudas" },
      { texto: "Quiero hablar con alguien", va: "persona" },
    ],
  },

  /* ---------------------------------------------------------------- buscar */
  {
    id: "que-busca",
    mensaje: "¿Sabés qué necesitás o preferís que te muestre por rubro?",
    opciones: [
      { texto: "Lo busco por nombre", va: "buscar-texto" },
      { texto: "Mostrame por rubro", va: "rubros" },
    ],
  },
  {
    id: "buscar-texto",
    mensaje:
      "Escribí lo que buscás: el nombre, la medida o el código. Por ejemplo «fenólico 18» o «machimbre pino».",
    accion: { tipo: "buscar" },
    opciones: [{ texto: "Mejor mostrame por rubro", va: "rubros" }],
  },
  {
    id: "rubros",
    mensaje: "¿De qué rubro?",
    // Las opciones de este paso se arman con las categorías reales del
    // catálogo: una lista escrita a mano se desactualiza el día que alguien
    // agrega un rubro desde el panel.
    opciones: [],
  },

  /* ------------------------------------------------------------- calcular */
  {
    id: "calcular",
    mensaje:
      "Te hago la cuenta. ¿Qué estás por hacer?",
    opciones: [
      { texto: "Un techo", va: "calc-techos" },
      { texto: "Cortar placas para un mueble", va: "calc-placas" },
      { texto: "Un piso", va: "calc-pisos" },
      { texto: "Un deck", va: "calc-decks" },
    ],
  },
  {
    id: "calc-techos",
    mensaje:
      "Pasame el largo y el ancho del techo y te digo los tirantes, el machimbre, la aislación y los clavos que entran.",
    accion: { tipo: "calculadora", cual: "techos" },
    opciones: [],
  },
  {
    id: "calc-placas",
    mensaje:
      "Cargá las piezas que necesitás y te digo cuántas placas salen y cuánto se aprovecha.",
    accion: { tipo: "calculadora", cual: "placas" },
    opciones: [],
  },
  {
    id: "calc-pisos",
    mensaje: "Con el largo y el ancho del ambiente te calculo cajas y zócalos.",
    accion: { tipo: "calculadora", cual: "pisos" },
    opciones: [],
  },
  {
    id: "calc-decks",
    mensaje: "Decime la medida del deck y el material, y te doy las tablas y la estructura.",
    accion: { tipo: "calculadora", cual: "decks" },
    opciones: [],
  },

  /* ---------------------------------------------------------------- dudas */
  {
    id: "dudas",
    mensaje: "¿Sobre qué?",
    opciones: [
      { texto: "¿Cortan a medida?", va: "cortes" },
      { texto: "¿Hacen envíos?", va: "envios" },
      { texto: "Horarios y direcciones", va: "sucursales" },
      { texto: "Formas de pago", va: "pagos" },
      { texto: "Quiero cuenta corriente", va: "profesionales" },
    ],
  },
  {
    id: "cortes",
    mensaje:
      "Sí. Cortamos placas a medida en el aserradero: pasanos el despiece con las medidas en milímetros y te lo preparamos. Si son muchas piezas, lo más cómodo es mandarlo por WhatsApp y te cotizamos el corte junto con el material.",
    opciones: [
      { texto: "Mandar el despiece", va: "persona" },
      { texto: "Calcular cuántas placas necesito", va: "calc-placas" },
    ],
  },
  {
    id: "envios",
    mensaje: "Sí, entregamos en Mar del Plata y la zona. Estas son las zonas y lo que sale el flete:",
    accion: { tipo: "dato", cual: "envios" },
    opciones: [{ texto: "Ver el catálogo", va: "rubros" }],
  },
  {
    id: "sucursales",
    mensaje: "Tenemos dos locales:",
    accion: { tipo: "dato", cual: "sucursales" },
    opciones: [],
  },
  {
    id: "pagos",
    mensaje: "Se puede pagar así:",
    accion: { tipo: "dato", cual: "pagos" },
    opciones: [],
  },
  {
    id: "profesionales",
    mensaje:
      "Si sos carpintero, constructor, arquitecto o tenés una empresa, podés pedir la cuenta profesional: tenés precios de lista propia, cuenta corriente y descuentos por cantidad. Se pide desde el portal y lo aprobamos nosotros.",
    accion: { tipo: "ir", ruta: "/profesionales" },
    opciones: [],
  },

  /* -------------------------------------------------------------- persona */
  {
    id: "persona",
    mensaje:
      "Te paso con alguien del mostrador. Contales qué necesitás y te responden en el horario del local.",
    accion: {
      tipo: "whatsapp",
      mensaje: "Hola! Vengo del asistente de la web y quería consultar por...",
    },
    opciones: [],
  },
];

/** Todos los pasos, con la vuelta al inicio ya agregada donde corresponde. */
export const GUION: PasoDelGuion[] = PASOS.map((paso) => ({
  ...paso,
  opciones:
    paso.id === PASO_INICIAL || paso.opciones.some((o) => o.va === PASO_INICIAL)
      ? paso.opciones
      : [...paso.opciones, VOLVER],
}));

export function pasoPorId(id: string): PasoDelGuion | null {
  return GUION.find((p) => p.id === id) ?? null;
}

/** Los destinos que no existen. Vacío es lo que se espera. */
export function ramasRotas(): string[] {
  const ids = new Set(GUION.map((p) => p.id));
  const rotas: string[] = [];

  for (const paso of GUION) {
    for (const opcion of paso.opciones) {
      if (!ids.has(opcion.va)) rotas.push(`${paso.id} → ${opcion.va}`);
    }
  }

  return rotas;
}
