/**
 * El aviso por WhatsApp que manda una persona, gratis.
 *
 * Desde el 1/10/2026 Meta cobra todo lo que sale por la Cloud API, también
 * contestar dentro de las 24 h. Lo que se manda desde la app WhatsApp Business
 * —en el teléfono, WhatsApp Desktop o WhatsApp Web con el número de la
 * maderera— no cuesta nada. El botón «Avisar por WhatsApp» abre esa app con el
 * chat del cliente y el texto ya escrito (`https://wa.me/<número>?text=…`): el
 * vendedor solo toca enviar. Anda aunque no haya nada conectado con Meta.
 *
 * **El texto es el de la plantilla**, rellenado con los datos reales: una sola
 * fuente (`plantillas-base.ts`) para el aviso automático y el manual, así el
 * cliente lee lo mismo salga por donde salga y nadie mantiene dos versiones.
 *
 * Puro, sin base ni `server-only`: lo arma el servidor y lo prueban los tests.
 */

import { plantillaBase } from "./plantillas-base";
import { completar, marcadores } from "./plantillas";
import { aWaId, numeroLegible } from "./numeros";

/**
 * Los avisos que se pueden mandar a mano, con su plantilla.
 *
 * La clave es el mismo `evento` del aviso automático (`EVENTOS_WHATSAPP` en
 * `avisos.ts`) cuando lo hay: así el automático sabe que alguien ya avisó a
 * mano y no lo repite, y la bitácora junta los dos.
 */
export const AVISOS_MANUALES = {
  pedido_recibido: { plantilla: "pedido_recibido", titulo: "Pedido recibido" },
  preparando: { plantilla: "pedido_preparando", titulo: "Pedido en preparación" },
  listo: { plantilla: "pedido_listo", titulo: "Pedido listo para retirar" },
  "en-camino": { plantilla: "pedido_en_camino", titulo: "Pedido en camino" },
  entregado: { plantilla: "pedido_entregado", titulo: "Pedido entregado" },
  corte_listo: { plantilla: "corte_listo", titulo: "Corte terminado" },
  presupuesto_listo: { plantilla: "presupuesto_enviado", titulo: "Presupuesto" },
  recibo_emitido: { plantilla: "recibo_emitido", titulo: "Recibo" },
  cheque_rechazado: { plantilla: "cheque_rechazado", titulo: "Cheque rechazado" },
  recordatorio_saldo: { plantilla: "recordatorio_saldo", titulo: "Recordatorio de saldo" },
  documento: { plantilla: "documento_adjunto", titulo: "Documento" },
} as const;

export type EventoManual = keyof typeof AVISOS_MANUALES;

export function esEventoManual(valor: unknown): valor is EventoManual {
  return typeof valor === "string" && Object.hasOwn(AVISOS_MANUALES, valor);
}

/** El cuerpo de la plantilla, tal cual se carga en Meta. */
export function cuerpoDePlantilla(nombre: string): string | null {
  const base = plantillaBase(nombre);
  const cuerpo = base?.componentes.find((c) => (c as { type?: string }).type === "BODY") as
    | { text?: string }
    | undefined;
  return cuerpo?.text ?? null;
}

/**
 * Saca la oración que depende de un dato que no hay.
 *
 * «El horario es {{horario}}.» sin horario cargado quedaría «El horario es
 * {{horario}}.» en el teléfono del cliente. Mejor que no esté.
 */
function sinOracionesVacias(texto: string, valores: Record<string, string>): string {
  const faltan = marcadores(texto).filter((m) => !valores[m]?.trim());
  if (faltan.length === 0) return texto;
  // Oraciones: hasta el punto, el signo de pregunta o de exclamación.
  const oraciones = texto.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) ?? [texto];
  return oraciones
    .filter((o) => !faltan.some((m) => o.includes(`{{${m}}}`)))
    .join("")
    .trim();
}

/** El primer nombre para el saludo; «qué tal» si no hay, igual que el automático. */
export function primerNombre(nombre: string | null | undefined): string {
  return (nombre ?? "").trim().split(/\s+/)[0] || "qué tal";
}

export interface DatosAvisoManual {
  evento: EventoManual;
  nombre: string | null | undefined;
  telefono: string | null | undefined;
  valores: Record<string, string>;
  /** Un enlace público con token, para que el cliente vea el pedido. */
  enlace?: { texto: string; url: string } | null;
}

export interface AvisoManualArmado {
  texto: string;
  /** La dirección de wa.me, o null si no se puede armar (ver `motivo`). */
  href: string | null;
  /** Por qué no hay botón: sin teléfono, o un teléfono que no se entiende. */
  motivo: string | null;
  /** «+54 9 223 590-3118», para decir a quién va. */
  telefono: string | null;
}

/**
 * La dirección de wa.me para un número, con el texto opcional.
 *
 * El número va con el 9 (`549…`): wa.me no reconoce un celular argentino sin
 * él. El texto va codificado entero (`encodeURIComponent`), saltos de línea y
 * acentos incluidos.
 */
export function enlaceWaMe(telefono: string | null | undefined, texto?: string | null): string | null {
  if (!telefono) return null;
  const waId = aWaId(telefono);
  if (!waId) return null;
  return texto ? `https://wa.me/${waId}?text=${encodeURIComponent(texto)}` : `https://wa.me/${waId}`;
}

/** El texto del aviso y el enlace de wa.me que lo abre. */
export function armarAvisoManual(datos: DatosAvisoManual): AvisoManualArmado {
  const plantilla = AVISOS_MANUALES[datos.evento].plantilla;
  const cuerpo = cuerpoDePlantilla(plantilla) ?? "Hola {{nombre}}, te escribimos de la maderera.";
  const valores = { ...datos.valores, nombre: primerNombre(datos.nombre) };

  let texto = completar(sinOracionesVacias(cuerpo, valores), valores);
  if (datos.enlace) texto += `\n\n${datos.enlace.texto}: ${datos.enlace.url}`;

  const telefono = datos.telefono?.trim() || null;
  if (!telefono) {
    return { texto, href: null, motivo: "El cliente no tiene teléfono cargado.", telefono: null };
  }
  const waId = aWaId(telefono);
  if (!waId) {
    return { texto, href: null, motivo: `El teléfono «${telefono}» no parece un número de WhatsApp.`, telefono };
  }
  return { texto, href: enlaceWaMe(telefono, texto), motivo: null, telefono: numeroLegible(waId) };
}
