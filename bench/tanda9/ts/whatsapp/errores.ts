// @ts-nocheck: copiado tal cual de git 9a17128, ver ../../README.md.
/**
 * Los errores de Meta, dichos para quien está atendiendo.
 *
 * La Graph API contesta con un código numérico y un texto en inglés pensado
 * para el programador. En la bandeja eso no sirve: quien atiende necesita saber
 * **qué le pasó al mensaje y qué hacer**. «(#131047) Re-engagement message» es
 * «pasaron más de 24 horas: mandá un mensaje preparado».
 *
 * Puro, sin `server-only`: lo usan el proveedor (al enviar), la ingesta (al
 * llegar un estado `failed`) y la bandeja, y se prueba con los códigos de la
 * documentación («Cloud API › Error codes»).
 */

export type Accion =
  /** Fuera de la ventana: ofrecer plantilla. */
  | "plantilla"
  /** Volver a probar más tarde (límite de velocidad, Meta caída). */
  | "reintentar"
  /** Lo tiene que arreglar quien mantiene el sistema (token, permisos). */
  | "sistema"
  /** El destinatario no puede recibirlo: avisarle por otro medio. */
  | "otro-medio"
  /** Revisar el contenido: la plantilla o el archivo. */
  | "revisar"
  /** Se pasó el tope del mes: confirmar que se quiere pagar, o mandarlo gratis desde el teléfono. */
  | "tope";

export interface ErrorExplicado {
  codigo: number | null;
  /** Lo que se muestra en la bandeja. */
  texto: string;
  accion: Accion;
}

const EXPLICACIONES: Record<number, { texto: string; accion: Accion }> = {
  131047: {
    texto:
      "Pasaron más de 24 horas desde su último mensaje. Para retomar la conversación hay que mandar un mensaje preparado.",
    accion: "plantilla",
  },
  470: {
    texto:
      "Pasaron más de 24 horas desde su último mensaje. Para retomar la conversación hay que mandar un mensaje preparado.",
    accion: "plantilla",
  },
  131026: {
    texto:
      "WhatsApp no lo pudo entregar: el número puede no tener WhatsApp, tener la aplicación desactualizada o habernos bloqueado. Conviene llamarlo.",
    accion: "otro-medio",
  },
  131049: {
    texto:
      "WhatsApp frenó este mensaje porque esa persona ya recibió muchos mensajes de empresas. Probá en unos días o avisale por otro medio.",
    accion: "otro-medio",
  },
  131050: {
    texto: "Esa persona pidió no recibir mensajes de promoción de la maderera.",
    accion: "otro-medio",
  },
  131056: {
    texto: "Se le mandaron demasiados mensajes seguidos a este número. Esperá un minuto y volvé a probar.",
    accion: "reintentar",
  },
  130429: {
    texto: "WhatsApp está limitando la cantidad de mensajes por segundo. Volvé a probar en un momento.",
    accion: "reintentar",
  },
  131048: {
    texto:
      "WhatsApp limitó los envíos porque muchos mensajes del número fueron marcados como no deseados. Hay que revisar la calidad del número en la configuración.",
    accion: "sistema",
  },
  131000: {
    texto: "WhatsApp tuvo un problema y no envió el mensaje. Volvé a probar en un momento.",
    accion: "reintentar",
  },
  131016: {
    texto: "WhatsApp está con problemas en este momento. Volvé a probar en unos minutos.",
    accion: "reintentar",
  },
  2: {
    texto: "WhatsApp no está disponible en este momento. Volvé a probar en unos minutos.",
    accion: "reintentar",
  },
  190: {
    texto:
      "El permiso de la plataforma para usar WhatsApp venció o se revocó. Hay que generar uno nuevo en Meta (lo hace quien mantiene el sistema).",
    accion: "sistema",
  },
  10: {
    texto: "La plataforma no tiene permiso para mandar mensajes con este número. Avisale a quien mantiene el sistema.",
    accion: "sistema",
  },
  200: {
    texto: "La plataforma no tiene permiso para mandar mensajes con este número. Avisale a quien mantiene el sistema.",
    accion: "sistema",
  },
  131005: {
    texto: "Meta negó el acceso a este número. Avisale a quien mantiene el sistema.",
    accion: "sistema",
  },
  133010: {
    texto: "El número del negocio no está registrado en la Cloud API. Avisale a quien mantiene el sistema.",
    accion: "sistema",
  },
  131031: {
    texto: "Meta bloqueó la cuenta de WhatsApp del negocio. Hay que revisarlo en el administrador de WhatsApp de Meta.",
    accion: "sistema",
  },
  368: {
    texto:
      "Meta bloqueó temporalmente los envíos por una infracción a sus políticas. Hay que revisarlo en el administrador de WhatsApp de Meta.",
    accion: "sistema",
  },
  131042: {
    texto: "Meta no está cobrando: falta o falló el medio de pago de la cuenta de WhatsApp. Hay que revisarlo en Meta.",
    accion: "sistema",
  },
  131051: {
    texto: "WhatsApp no admite ese tipo de mensaje.",
    accion: "revisar",
  },
  131052: {
    texto: "No se pudo bajar el archivo que mandó el cliente.",
    accion: "reintentar",
  },
  131053: {
    texto: "WhatsApp no aceptó el archivo: puede ser muy pesado o de un formato que no admite. Probá con un PDF o una foto JPG.",
    accion: "revisar",
  },
  132000: {
    texto: "El mensaje preparado no tiene los datos que espera. Revisá que estén todos completos.",
    accion: "revisar",
  },
  132001: {
    texto: "Ese mensaje preparado no existe en Meta, o no en este idioma. Volvé a sincronizar las plantillas.",
    accion: "revisar",
  },
  132005: {
    texto: "Con los datos completos, el mensaje preparado queda demasiado largo. Acortá alguno.",
    accion: "revisar",
  },
  132007: {
    texto: "Meta rechazó el texto del mensaje preparado por sus políticas.",
    accion: "revisar",
  },
  132012: {
    texto: "Algún dato del mensaje preparado no tiene el formato que espera Meta.",
    accion: "revisar",
  },
  132015: {
    texto: "Meta pausó ese mensaje preparado por baja calidad. Usá otro o revisalo en Meta.",
    accion: "revisar",
  },
  132016: {
    texto: "Meta desactivó ese mensaje preparado. Usá otro.",
    accion: "revisar",
  },
  131008: {
    texto: "Faltó un dato obligatorio en el mensaje.",
    accion: "revisar",
  },
  131009: {
    texto: "Algún dato del mensaje no es válido (puede ser el número o el archivo).",
    accion: "revisar",
  },
  100: {
    texto: "Meta rechazó el pedido por un dato inválido.",
    accion: "revisar",
  },
  131021: {
    texto: "No se puede mandar un mensaje al número del propio negocio.",
    accion: "revisar",
  },
};

/** Explica un error de Meta. Un código desconocido igual da un texto útil. */
export function explicarError(codigo: number | null | undefined, detalle?: string | null): ErrorExplicado {
  const conocido = codigo ? EXPLICACIONES[codigo] : undefined;
  if (conocido) return { codigo: codigo ?? null, ...conocido };
  return {
    codigo: codigo ?? null,
    texto: `WhatsApp no envió el mensaje${detalle ? ` («${detalle.slice(0, 160)}»)` : ""}. Volvé a probar, y si sigue pasando avisale a quien mantiene el sistema.`,
    accion: "reintentar",
  };
}

/** Si el error dice «fuera de la ventana de 24 h». */
export function esFueraDeVentana(codigo: number | null | undefined): boolean {
  return codigo === 131047 || codigo === 470;
}

/** Si el problema es del token o los permisos y no del mensaje. */
export function esDeCredenciales(codigo: number | null | undefined): boolean {
  return codigo === 190 || codigo === 10 || codigo === 200 || codigo === 131005;
}
