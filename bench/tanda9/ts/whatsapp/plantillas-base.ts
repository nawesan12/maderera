// @ts-nocheck: copiado tal cual de git 9a17128, ver ../../README.md.
import type { PlantillaRemota } from "./tipos";

/**
 * Las plantillas que MJBJ necesita aprobadas en Meta.
 *
 * Sirven para tres cosas:
 *
 * 1. **Son el texto exacto a cargar en Meta.** `docs/WHATSAPP.md` las lista
 *    tal cual y la configuración las muestra con su estado. Si se cargan con
 *    el mismo nombre, idioma y variables, los avisos quedan andando sin tocar
 *    una línea.
 * 2. **En demostración son el catálogo de la bandeja**, para poder probar el
 *    flujo completo antes de tener el WABA.
 * 3. **Dicen qué dato va en cada variable**: los avisos completan por nombre
 *    (`{{nombre}}`, `{{pedido}}`), no por posición.
 *
 * Variables con nombre y no `{{1}}`: Meta las acepta desde 2025
 * (`parameter_format: NAMED`) y quien revisa la plantilla —en Meta y en la
 * maderera— entiende qué va en cada hueco. Una plantilla vieja posicional
 * sigue funcionando: `sugerirValores` completa por el orden de siempre.
 *
 * **Todas son `UTILITY`**: informan sobre algo que la persona ya inició —su
 * pedido, su presupuesto, su pago— y no ofrecen nada. Meta las revisa con ese
 * criterio y si encuentra tono de promoción las pasa a `MARKETING`, que cuesta
 * más del triple y además no se puede mandar a quien bajó las promociones. Por
 * eso no dicen «aprovechá», «oferta» ni «te esperamos para tu próxima compra».
 *
 * Reglas de Meta que estos textos respetan: ninguna variable al principio ni
 * al final del cuerpo, nunca dos variables seguidas, y cada una con su
 * ejemplo (sin ejemplo la rechazan).
 */

type Base = Omit<PlantillaRemota, "metaId" | "estado" | "motivoRechazo" | "formatoParametros"> & {
  /** Para qué es, en una línea, para la configuración y la guía. */
  uso: string;
};

function cuerpo(texto: string, ejemplos: Record<string, string>) {
  return {
    type: "BODY",
    text: texto,
    example: {
      body_text_named_params: Object.entries(ejemplos).map(([param_name, example]) => ({
        param_name,
        example,
      })),
    },
  };
}

const PIE = { type: "FOOTER", text: "Maderera Juan B. Justo" };

/** Encabezado con el PDF: la factura, el remito o el presupuesto van pegados al mensaje. */
const ENCABEZADO_PDF = { type: "HEADER", format: "DOCUMENT", example: { header_handle: ["<se sube al crearla>"] } };

const PLANTILLAS: Base[] = [
  {
    nombre: "pedido_recibido",
    idioma: "es_AR",
    categoria: "UTILITY",
    uso: "Cuando entra un pedido por la web.",
    componentes: [
      cuerpo(
        "Hola {{nombre}}, recibimos tu pedido {{pedido}}. Te avisamos por acá cuando esté listo. Si tenés alguna duda, respondé este mensaje.",
        { nombre: "Marta", pedido: "PED-1207" },
      ),
      PIE,
    ],
  },
  {
    nombre: "pedido_preparando",
    idioma: "es_AR",
    categoria: "UTILITY",
    uso: "Cuando el pedido pasa a Preparando.",
    componentes: [
      cuerpo(
        "Hola {{nombre}}, ya estamos preparando tu pedido {{pedido}}. Te escribimos apenas esté listo.",
        { nombre: "Marta", pedido: "PED-1207" },
      ),
      PIE,
    ],
  },
  {
    nombre: "pedido_listo",
    idioma: "es_AR",
    categoria: "UTILITY",
    uso: "Cuando el pedido queda listo para retirar.",
    componentes: [
      cuerpo(
        "Hola {{nombre}}, tu pedido {{pedido}} ya está listo para retirar en {{sucursal}}. El horario es {{horario}}. Si lo retira otra persona, avisanos por acá.",
        {
          nombre: "Marta",
          pedido: "PED-1207",
          sucursal: "Casa Central, Av. Juan B. Justo 4153",
          horario: "de lunes a viernes de 8 a 16 y los sábados de 8 a 12",
        },
      ),
      PIE,
    ],
  },
  {
    nombre: "pedido_en_camino",
    idioma: "es_AR",
    categoria: "UTILITY",
    uso: "Cuando el pedido sale con el flete.",
    componentes: [
      cuerpo(
        "Hola {{nombre}}, tu pedido {{pedido}} salió para la dirección de entrega. Si necesitás coordinar algo con el flete, respondé este mensaje.",
        { nombre: "Marta", pedido: "PED-1207" },
      ),
      PIE,
    ],
  },
  {
    nombre: "pedido_entregado",
    idioma: "es_AR",
    categoria: "UTILITY",
    uso: "Cuando se entrega el pedido.",
    componentes: [
      cuerpo(
        "Hola {{nombre}}, entregamos tu pedido {{pedido}}. Si algo no llegó como esperabas, contanos por acá y lo resolvemos.",
        { nombre: "Marta", pedido: "PED-1207" },
      ),
      PIE,
    ],
  },
  {
    nombre: "corte_listo",
    idioma: "es_AR",
    categoria: "UTILITY",
    uso: "Cuando el aserradero termina un trabajo de corte.",
    componentes: [
      cuerpo(
        "Hola {{nombre}}, tu trabajo de corte {{corte}} está terminado y listo para retirar en {{sucursal}}. Cualquier consulta, respondé este mensaje.",
        { nombre: "Marta", corte: "COR-0412", sucursal: "Aserradero" },
      ),
      PIE,
    ],
  },
  {
    nombre: "presupuesto_enviado",
    idioma: "es_AR",
    categoria: "UTILITY",
    uso: "Para mandar el PDF de un presupuesto que pidió el cliente.",
    componentes: [
      ENCABEZADO_PDF,
      cuerpo(
        "Hola {{nombre}}, te mandamos el presupuesto {{presupuesto}} por {{total}} que nos pediste. Vale hasta el {{vence}}. Para confirmarlo o cambiar algo, respondé este mensaje.",
        { nombre: "Marta", presupuesto: "PRE-0388", total: "$ 412.500", vence: "24/10/2026" },
      ),
      PIE,
    ],
  },
  {
    nombre: "documento_adjunto",
    idioma: "es_AR",
    categoria: "UTILITY",
    uso: "Para mandar una factura, un remito, un recibo, el resumen de cuenta o el plano de corte.",
    componentes: [
      ENCABEZADO_PDF,
      cuerpo(
        "Hola {{nombre}}, te mandamos {{documento}} de tu compra en la maderera. Si tenés alguna duda, respondé este mensaje.",
        { nombre: "Marta", documento: "el remito R-0001-00000452" },
      ),
      PIE,
    ],
  },
  {
    nombre: "recibo_emitido",
    idioma: "es_AR",
    categoria: "UTILITY",
    uso: "Cuando se registra un pago y sale el recibo.",
    componentes: [
      ENCABEZADO_PDF,
      cuerpo(
        "Hola {{nombre}}, registramos tu pago de {{importe}} y te mandamos el recibo {{recibo}}. Tu saldo en cuenta corriente quedó en {{saldo}}. Gracias.",
        { nombre: "Marta", importe: "$ 150.000", recibo: "REC-0042", saldo: "$ 0" },
      ),
      PIE,
    ],
  },
  {
    nombre: "cheque_rechazado",
    idioma: "es_AR",
    categoria: "UTILITY",
    uso: "Cuando un cheque del cliente no se toma o lo rechaza el banco.",
    componentes: [
      cuerpo(
        "Hola {{nombre}}, el cheque {{cheque}} por {{importe}} no se pudo acreditar ({{motivo}}). El importe volvió a tu cuenta corriente. Escribinos por acá para ver cómo lo resolvemos.",
        {
          nombre: "Marta",
          cheque: "Banco Provincia N.º 00123456",
          importe: "$ 230.000",
          motivo: "sin fondos",
        },
      ),
      PIE,
    ],
  },
  {
    nombre: "recordatorio_saldo",
    idioma: "es_AR",
    categoria: "UTILITY",
    uso: "Para recordarle a un cliente el saldo de su cuenta corriente.",
    componentes: [
      cuerpo(
        "Hola {{nombre}}, te recordamos que tu cuenta corriente tiene un saldo de {{saldo}} al {{fecha}}. Si ya lo pagaste, no hace falta que hagas nada. Para cualquier consulta, respondé este mensaje.",
        { nombre: "Marta", saldo: "$ 412.500", fecha: "14/10/2026" },
      ),
      PIE,
    ],
  },
  {
    nombre: "retomar_conversacion",
    idioma: "es_AR",
    categoria: "UTILITY",
    uso: "Para contestar una consulta cuando pasaron más de 24 horas.",
    componentes: [
      cuerpo(
        "Hola {{nombre}}, te escribimos por la consulta que nos hiciste. ¿Seguimos por acá?",
        { nombre: "Marta" },
      ),
      PIE,
    ],
  },
];

export const PLANTILLAS_BASE: (PlantillaRemota & { uso: string })[] = PLANTILLAS.map((p) => ({
  ...p,
  metaId: null,
  estado: "APPROVED",
  motivoRechazo: null,
  formatoParametros: "NAMED",
}));

/** Busca una plantilla del catálogo base por nombre. */
export function plantillaBase(nombre: string) {
  return PLANTILLAS_BASE.find((p) => p.nombre === nombre);
}
