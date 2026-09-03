import {
  entender,
  type Entendido,
  type Intencion,
} from "@/lib/asistente/lenguaje";

/**
 * Las respuestas que **no** necesitan el servidor.
 *
 * Todo lo que el asistente contesta y es igual para cualquiera —horarios,
 * zonas de envío, formas de pago, si cortan a medida, cómo se pide la cuenta
 * corriente— se resuelve acá, en el navegador, con los datos que bajaron una
 * sola vez al abrir el panel. Preguntar el horario no tiene por qué costar una
 * ida al servidor: la respuesta ya está.
 *
 * Lo que sí va al servidor es buscar productos, y por una razón concreta: el
 * precio depende de la lista de quien mira, así que el catálogo no puede vivir
 * en el navegador. Ver `lib/dal/precios-sesion.ts`.
 */

export interface DatoSuelto {
  titulo: string;
  detalle: string;
}

export interface Equipaje {
  sucursales: DatoSuelto[];
  envios: DatoSuelto[];
  pagos: DatoSuelto[];
}

export interface RespuestaLocal {
  texto: string;
  datos?: DatoSuelto[];
  sugerencias?: { texto: string; va: string }[];
  calculadora?: "techos" | "placas" | "pisos" | "decks";
  aPersona?: boolean;
}

/** Qué intenciones se pueden contestar sin el servidor. */
const SIN_SERVIDOR: Intencion[] = [
  "saludo",
  "gracias",
  "envios",
  "horarios",
  "pagos",
  "cortes",
  "cuenta",
  "calcular",
  "persona",
];

export function seContestaSolo(leido: Entendido): boolean {
  return SIN_SERVIDOR.includes(leido.intencion);
}

const CALCULADORA_POR_RUBRO: Record<string, RespuestaLocal["calculadora"]> = {
  techos: "techos",
  cubiertas: "techos",
  placas: "placas",
  pisos: "pisos",
  decks: "decks",
};

/**
 * La respuesta, si se puede dar sin preguntarle a nadie.
 *
 * Devuelve `null` cuando hace falta el catálogo, y ahí el panel sí llama al
 * servidor.
 */
export function responderLocal(
  textoLibre: string,
  equipaje: Equipaje,
): RespuestaLocal | null {
  const leido = entender(textoLibre);
  if (!seContestaSolo(leido)) return null;

  switch (leido.intencion) {
    case "saludo":
      return {
        texto:
          "¡Hola! Decime qué estás buscando —una placa, un machimbre, lo que sea— y te digo si lo tenemos y a cuánto.",
        sugerencias: [
          { texto: "Ver los rubros", va: "rubros" },
          { texto: "Calcular material", va: "calcular" },
        ],
      };

    case "gracias":
      return {
        texto: "De nada. Si necesitás algo más, escribime.",
      };

    case "envios":
      return {
        texto:
          "Sí, entregamos en Mar del Plata y la zona. Estas son las zonas y lo que sale el flete:",
        datos: equipaje.envios,
      };

    case "horarios":
      return {
        texto: "Estos son los locales, con horarios y teléfono:",
        datos: equipaje.sucursales,
      };

    case "pagos":
      return { texto: "Se puede pagar así:", datos: equipaje.pagos };

    case "cortes":
      return {
        texto:
          "Sí, cortamos placas a medida en el aserradero. Pasanos el despiece con las medidas en milímetros y te lo preparamos junto con el material. Si son muchas piezas conviene mandarlo por WhatsApp.",
        sugerencias: [
          { texto: "Calcular cuántas placas necesito", va: "calc-placas" },
          { texto: "Mandar el despiece", va: "persona" },
        ],
      };

    case "cuenta":
      return {
        texto:
          "Si trabajás del rubro —carpintería, construcción, arquitectura— podés pedir la cuenta profesional: lista de precios propia, cuenta corriente y descuentos por cantidad. Se pide desde el portal y lo aprobamos nosotros.",
        sugerencias: [{ texto: "Ir al portal", va: "profesionales" }],
      };

    case "calcular": {
      const cual = leido.rubro ? CALCULADORA_POR_RUBRO[leido.rubro] : undefined;

      return {
        texto: cual
          ? "Te hago la cuenta. Abrí la calculadora y cargá las medidas:"
          : "Te hago la cuenta. ¿Qué estás por hacer?",
        calculadora: cual,
        sugerencias: cual
          ? undefined
          : [
              { texto: "Un techo", va: "calc-techos" },
              { texto: "Placas para un mueble", va: "calc-placas" },
              { texto: "Un piso", va: "calc-pisos" },
              { texto: "Un deck", va: "calc-decks" },
            ],
      };
    }

    default:
      return {
        texto:
          "Te paso con alguien del mostrador. Contales qué necesitás y te responden en el horario del local.",
        aPersona: true,
      };
  }
}
