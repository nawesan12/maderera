import "server-only";

import { randomUUID } from "node:crypto";
import { PLANTILLAS_BASE } from "./plantillas-base";
import type { ProveedorWhatsapp } from "./tipos";

/**
 * Proveedor de demostración.
 *
 * Se usa mientras MJBJ siga atendiendo con WhatsApp Business común en el
 * teléfono: no habla con Meta, pero acepta todo lo que aceptaría la Cloud API y
 * devuelve lo mismo. Los mensajes se guardan en la base igual que los reales,
 * así que la bandeja se puede usar y probar completa —incluidos los avisos
 * automáticos— antes de que exista el WABA.
 *
 * Lo que NO hace es fingir que los mensajes llegan a alguien: el panel muestra
 * un cartel permanente diciendo que está en modo demostración. Un sistema que
 * simula haber avisado al cliente y no avisó es peor que no tener nada.
 */
export const proveedorDemo: ProveedorWhatsapp = {
  id: "demo",

  async estado() {
    return {
      conectado: false,
      proveedor: "demo",
      telefono: process.env.WHATSAPP_BUSINESS_PHONE ?? "+54 9 223 590-3118",
      ultimaSenal: Date.now(),
      detalle:
        "Modo demostración: los mensajes se guardan acá pero no salen a WhatsApp. Falta dar de alta el número en la Cloud API de Meta.",
    };
  },

  async enviarTexto() {
    return { waMessageId: `demo-${randomUUID()}` };
  },

  async enviarPlantilla() {
    return { waMessageId: `demo-${randomUUID()}` };
  },

  async listarPlantillas() {
    // En demostración el catálogo es el que hay que registrar en Meta. Cuando
    // el WABA exista, esta lista viene de la Graph API y esta queda como la
    // referencia de qué cargar.
    return PLANTILLAS_BASE;
  },
};
