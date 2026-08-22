import type { PlantillaAprobada } from "./tipos";

/**
 * Las plantillas que MJBJ va a necesitar aprobadas en Meta.
 *
 * Sirven para dos cosas. En demostración son el catálogo que muestra la
 * bandeja, para poder ver y probar el flujo completo antes de tener el WABA.
 * Y cuando llegue el momento del alta, son el texto exacto que hay que cargar
 * en Meta para que lo aprueben: los nombres coinciden con los que usan los
 * avisos automáticos, así que si se registran tal cual, el sistema queda
 * andando sin tocar una línea.
 *
 * Están redactadas siguiendo lo que Meta acepta en categoría `utility`:
 * informan sobre algo que la persona ya inició —su pedido, su presupuesto— y no
 * ofrecen nada. Las de `marketing` se rechazan mucho más y se cobran distinto.
 */
export const PLANTILLAS_BASE: PlantillaAprobada[] = [
  {
    nombre: "pedido_recibido",
    idioma: "es_AR",
    cuerpo:
      "Hola {{1}}! Recibimos tu pedido {{2}} en Maderera Juan B. Justo. Te avisamos por acá cuando esté listo. Cualquier duda, respondé este mensaje.",
    variables: 2,
    categoria: "utility",
  },
  {
    nombre: "pedido_preparando",
    idioma: "es_AR",
    cuerpo:
      "Hola {{1}}! Ya estamos preparando tu pedido {{2}}. Te escribimos apenas esté listo para retirar.",
    variables: 2,
    categoria: "utility",
  },
  {
    nombre: "pedido_listo",
    idioma: "es_AR",
    cuerpo:
      "Hola {{1}}! Tu pedido {{2}} ya está listo para retirar en {{3}}. Te esperamos de lunes a viernes de 8 a 16 y sábados de 8 a 12.",
    variables: 3,
    categoria: "utility",
  },
  {
    nombre: "pedido_en_camino",
    idioma: "es_AR",
    cuerpo:
      "Hola {{1}}! Tu pedido {{2}} salió para la dirección que nos diste. Si necesitás coordinar algo con el fletero, respondé este mensaje.",
    variables: 2,
    categoria: "utility",
  },
  {
    nombre: "pedido_entregado",
    idioma: "es_AR",
    cuerpo:
      "Hola {{1}}! Entregamos tu pedido {{2}}. Gracias por elegirnos. Si algo no llegó como esperabas, contanos y lo resolvemos.",
    variables: 2,
    categoria: "utility",
  },
  {
    nombre: "presupuesto_enviado",
    idioma: "es_AR",
    cuerpo:
      "Hola {{1}}! Te preparamos el presupuesto {{2}} por {{3}}. Podés verlo y confirmarlo desde tu cuenta en la web, o responder este mensaje.",
    variables: 3,
    categoria: "utility",
  },
  {
    nombre: "corte_listo",
    idioma: "es_AR",
    cuerpo:
      "Hola {{1}}! Tu trabajo de corte {{2}} está terminado y listo para retirar en {{3}}.",
    variables: 3,
    categoria: "utility",
  },
  {
    nombre: "retomar_conversacion",
    idioma: "es_AR",
    cuerpo:
      "Hola {{1}}! Te escribimos de Maderera Juan B. Justo por tu consulta. ¿Seguimos por acá?",
    variables: 1,
    categoria: "utility",
  },
];

/** Busca una plantilla del catálogo base por nombre. */
export function plantillaBase(nombre: string): PlantillaAprobada | undefined {
  return PLANTILLAS_BASE.find((p) => p.nombre === nombre);
}

/**
 * Completa los {{n}} de un cuerpo con los valores dados.
 *
 * Solo para previsualizar en el panel: el envío real manda las variables por
 * separado y el texto lo arma Meta con la plantilla aprobada.
 */
export function previsualizar(cuerpo: string, variables: string[]): string {
  return cuerpo.replace(/\{\{(\d+)\}\}/g, (_, n) => {
    const valor = variables[Number(n) - 1];
    return valor && valor.trim() ? valor : `{{${n}}}`;
  });
}
