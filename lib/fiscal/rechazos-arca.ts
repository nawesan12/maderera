/**
 * Qué hacer con un rechazo de ARCA.
 *
 * Go guarda el motivo tal como lo devuelve el servicio de factura
 * electrónica, con el código adelante y varios unidos por « · »
 * (`[10016] El numero o fecha del comprobante no se corresponde con el
 * proximo a autorizar. Consultar metodo FECompUltimoAutorizado.`). La
 * pantalla lo mostraba así, y la administración no tenía cómo saber qué
 * hacer. Esto lo traduce a la acción, y el texto original queda plegado
 * para el contador o para quien mantiene el sistema.
 *
 * Se reconoce por código cuando el código es conocido y, si no, por palabras
 * del mensaje: ARCA cambia la redacción entre versiones del servicio pero no
 * el tema. Lo que no se reconoce se muestra igual, con un consejo general.
 * Sin dependencias: es texto puro y tiene su prueba en
 * tests/rechazos-arca.test.ts.
 */

export interface MotivoDeRechazo {
  codigo: string | null;
  original: string;
  /** Qué hay que hacer, en el idioma de la administración. */
  queHacer: string;
}

// El 10016 es el número o la fecha. Reintentar arregla los dos: el sistema
// pide el número que corresponde y lo manda con la fecha de hoy.
const NUMERACION =
  "El número o la fecha no son los que espera ARCA. Volvé a mandarlo: sale con la fecha de hoy y el número que corresponde. Si sigue, dalo de baja.";
const RECEPTOR_DOCUMENTO =
  "El CUIT o documento del cliente está mal o no existe en ARCA. Corregí el receptor y volvé a mandarlo.";
const RECEPTOR_CUIT_A =
  "Una factura A necesita el CUIT del cliente. Corregí el receptor; si no lo tiene, dalo de baja y emití una B.";
const CONDICION_IVA =
  "La condición frente al IVA del cliente no corresponde con el tipo de factura. Corregí el receptor y volvé a mandarlo; si le corresponde otra letra, dalo de baja y emitilo de nuevo.";
// Sin CAE no hay nada que anular: lo que no es del receptor se da de baja,
// que libera el número y destraba la serie.
const IMPORTES =
  "Los importes no cierran (neto, IVA y total). Dalo de baja y emitilo de nuevo; si se repite, avisá a quien mantiene el sistema.";
const FECHA =
  "La fecha del comprobante está fuera de lo que ARCA acepta. Volvé a mandarlo: sale con la fecha de hoy.";
const PUNTO_DE_VENTA =
  "El punto de venta no está habilitado en ARCA para facturar desde el sistema. Revisalo en Configuración de ARCA.";
const CONEXION =
  "ARCA no aceptó la conexión del sistema (el certificado o su permiso). Avisá a quien mantiene el sistema.";
const SERVICIO =
  "ARCA tuvo un problema de su lado. Volvé a intentar en unos minutos.";
const SIN_CERTIFICADO =
  "Todavía no se mandó a ARCA: falta conectar el sistema (el certificado). Cuando esté, volvé a mandarlo a autorizar.";
const GENERAL =
  "Revisá los datos del cliente y volvé a mandarlo. Si no se resuelve, dalo de baja y emitilo de nuevo, y pasale el texto de ARCA a quien mantiene el sistema.";

/** Los códigos de WSFEv1 que se ven en la práctica. */
const POR_CODIGO: Record<string, string> = {
  "10016": NUMERACION,
  "10013": RECEPTOR_CUIT_A,
  "10015": RECEPTOR_DOCUMENTO,
  "10048": IMPORTES,
  "10242": CONDICION_IVA,
  "10243": CONDICION_IVA,
  "10246": CONDICION_IVA,
  "600": CONEXION,
  "601": CONEXION,
  "501": SERVICIO,
  "502": SERVICIO,
};

/** Por palabras, en orden: la primera que coincide gana. */
const POR_TEXTO: [RegExp, string][] = [
  // El que deja el propio sistema cuando no hay certificado: no es de ARCA.
  [/sin autorizaci[oó]n de ARCA|se cargue el certificado/i, SIN_CERTIFICADO],
  [/pr[oó]ximo a autorizar|FECompUltimoAutorizado/i, NUMERACION],
  [/condici[oó]n (frente al )?iva|CondicionIVAReceptor/i, CONDICION_IVA],
  [/DocTipo/i, RECEPTOR_CUIT_A],
  [/DocNro|documento|cuit/i, RECEPTOR_DOCUMENTO],
  [/ImpTotal|ImpNeto|ImpIVA|importe/i, IMPORTES],
  [/PtoVta|punto de venta/i, PUNTO_DE_VENTA],
  [/CbteFch|fecha/i, FECHA],
  [/token|sign|certificado|autoriza(do|ci[oó]n) para/i, CONEXION],
];

/** Separa los motivos y le pone a cada uno qué hacer. */
export function motivosDeRechazo(texto: string | null | undefined): MotivoDeRechazo[] {
  if (!texto?.trim()) return [];
  return texto
    .split(" · ")
    .map((parte) => parte.trim())
    .filter(Boolean)
    .map((original) => {
      const m = /^\[([^\]]+)\]\s*/.exec(original);
      const codigo = m ? m[1] : null;
      const mensaje = m ? original.slice(m[0].length) : original;
      const queHacer =
        (codigo && POR_CODIGO[codigo]) ??
        POR_TEXTO.find(([re]) => re.test(mensaje))?.[1] ??
        GENERAL;
      return { codigo, original, queHacer };
    });
}
