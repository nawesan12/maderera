import {
  entender,
  enlaceDelDespiece,
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
  aPersona?: boolean;
  /** Un botón que lleva a una pantalla: el cortador con el despiece cargado. */
  enlace?: { texto: string; href: string };
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
  "armar_corte",
  "moldava",
  "documentacion",
  "devoluciones",
  "acopio",
  "factura",
  "eventos",
  "persona",
];

export function seContestaSolo(leido: Entendido): boolean {
  return SIN_SERVIDOR.includes(leido.intencion);
}

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
          "¡Hola! Decime qué estás buscando —una placa, un machimbre— o pasame un despiece y te armo el corte.",
        sugerencias: [
          { texto: "Ver los rubros", va: "rubros" },
          { texto: "Armar un corte", va: "calc-placas" },
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
          "Sí, cortamos placas a medida en el aserradero. Escribime el despiece acá —«4 de 600x400 en melamina blanca con canto»— o armalo en el cortador.",
        enlace: { texto: "Abrir el cortador", href: "/corte" },
      };

    case "cuenta":
      return {
        texto:
          "Si trabajás del rubro —carpintería, construcción, arquitectura— podés pedir la cuenta profesional: lista de precios propia, cuenta corriente y descuentos por cantidad. Se pide desde el portal y lo aprobamos nosotros.",
        sugerencias: [{ texto: "Ir al portal", va: "profesionales" }],
      };

    case "armar_corte": {
      const d = leido.despiece!;
      const unidades = d.piezas.reduce((s, p) => s + p.cantidad, 0);
      return {
        texto: `Te armé el corte: ${unidades} ${unidades === 1 ? "pieza" : "piezas"}${d.material ? ` en ${d.material}` : ""}. Abrilo para ver cómo entra en la placa y pedirlo.`,
        enlace: { texto: "Abrir el corte", href: enlaceDelDespiece(d) },
      };
    }

    case "moldava":
      return {
        texto: "Moldava es nuestra línea propia: molduras y listonería en pino finger joint, sin nudos, en piezas de 3,05 m.",
        enlace: { texto: "Ver Moldava", href: "/moldava" },
      };

    case "documentacion":
      return {
        texto: "Las fichas técnicas y tablas de carga están en la biblioteca. Cada producto tiene las suyas en su ficha.",
        enlace: { texto: "Ver la documentación", href: "/documentacion" },
      };

    case "devoluciones":
      return {
        texto: "Los cambios y devoluciones se hacen en la sucursal donde compraste, con el comprobante.",
        enlace: { texto: "Ver las condiciones", href: "/cambios-y-devoluciones" },
      };

    case "acopio":
      return {
        texto: "Sí: comprás ahora y lo retirás en partes. El material queda reservado a tu nombre.",
        aPersona: true,
      };

    case "factura":
      return {
        texto: "Facturamos A o B según tu condición frente al IVA. Para la A, pasanos el CUIT al comprar.",
      };

    case "eventos":
      return {
        texto: "Las capacitaciones y charlas están en la agenda.",
        enlace: { texto: "Ver capacitaciones", href: "/eventos" },
      };

    case "calcular": {
      return {
        texto: "Te hago la cuenta. ¿Qué estás por hacer?",
        sugerencias:
          leido.rubro === "placas"
            ? [{ texto: "Armar el corte", va: "calc-placas" }]
            : [
                { texto: "Cortar placas", va: "calc-placas" },
                { texto: "Un techo, un piso o un deck", va: "calc-obra" },
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
