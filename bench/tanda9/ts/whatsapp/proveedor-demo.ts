// @ts-nocheck: copiado tal cual de git 9a17128, ver ../../README.md.
import "server-only";

import { randomUUID } from "node:crypto";
import { PLANTILLAS_BASE } from "./plantillas-base";
import type { ProveedorWhatsapp } from "./tipos";

/**
 * Proveedor de demostración.
 *
 * Se usa mientras no haya credenciales de Meta: no habla con nadie, pero
 * acepta todo lo que aceptaría la Cloud API y devuelve lo mismo. Los mensajes
 * se guardan en la base igual que los reales, así que la bandeja se puede usar
 * completa —incluidos los avisos automáticos— antes de que exista el WABA.
 *
 * Lo que NO hace es fingir que los mensajes llegan a alguien: el panel muestra
 * un cartel permanente diciendo que está en modo demostración. Un sistema que
 * simula haber avisado al cliente y no avisó es peor que no tener nada.
 *
 * Para probar la Cloud API de verdad sin Meta está el simulador
 * (`scripts/simulador-meta.ts`), que usa el proveedor `cloud`.
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

  async enviar() {
    return { waMessageId: `demo-${randomUUID()}` };
  },

  async subirMedia() {
    return { id: `demo-media-${randomUUID()}` };
  },

  async bajarMedia() {
    return { error: "En demostración no hay archivos de Meta para bajar." };
  },

  async marcarLeido() {},

  async listarPlantillas() {
    // En demostración el catálogo es el que hay que registrar en Meta.
    return { plantillas: PLANTILLAS_BASE };
  },

  async diagnosticar() {
    return {
      puntos: [
        {
          clave: "demo",
          titulo: "Modo demostración",
          estado: "aviso",
          detalle:
            "No hay credenciales de Meta cargadas: la bandeja guarda todo pero no envía. Los pasos para conectar están en docs/WHATSAPP.md.",
        },
      ],
      numero: null,
    };
  },
};
