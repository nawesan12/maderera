import "server-only";

import { apiInterna, comoFormulario } from "@/lib/api/servidor";

/**
 * Los avisos automáticos por WhatsApp. Los decide y los manda la API de Go
 * (backend/internal/whatsapp/avisos.go): si está prendido, la baja, la
 * ventana, la plantilla, lo avisado a mano y el tope del mes. Acá queda solo
 * el envoltorio que usan los módulos que todavía son de TS (cobros,
 * presupuestos, ventas), con la misma firma de antes.
 *
 * **Nunca lanza**: si Go no contesta, la operación que disparó el aviso ya
 * terminó y no se voltea.
 */

export interface DocumentoDelAviso {
  contenido: Uint8Array;
  nombre: string;
  descripcion?: string;
}

type Estado = "enviada" | "simulada" | "fallida" | "omitida";

async function pedir(datos: Record<string, unknown>, documento?: DocumentoDelAviso | null) {
  const form = new FormData();
  form.append("datos", JSON.stringify(datos));
  if (documento) {
    form.append("archivo", new Blob([new Uint8Array(documento.contenido)], { type: "application/pdf" }), documento.nombre);
    form.append("archivoNombre", documento.nombre);
  }
  const r = await apiInterna.POST("/api/v1/interno/whatsapp/aviso", { body: form as never, ...comoFormulario });
  return r.data ?? { estado: "fallida" as const, detalle: `La API respondió ${r.response.status}.` };
}

/**
 * Manda un aviso por WhatsApp. El PDF (`documento`) se arma solo si el aviso
 * va a salir: Go contesta «falta-documento» y recién ahí se genera.
 */
export async function avisarPorWhatsapp(opciones: {
  evento: string;
  telefono: string | null | undefined;
  nombre: string | null | undefined;
  valores: Record<string, string>;
  documento?: (() => Promise<DocumentoDelAviso | null>) | null;
  orderId?: string | null;
  entidad?: { tipo: string; id: string } | null;
  forzar?: boolean;
  usuarioId?: string | null;
}): Promise<{ estado: Estado; detalle: string }> {
  try {
    const datos = {
      evento: opciones.evento,
      telefono: opciones.telefono ?? null,
      nombre: opciones.nombre ?? null,
      valores: opciones.valores,
      orderId: opciones.orderId ?? null,
      entidad: opciones.entidad ?? null,
      forzar: Boolean(opciones.forzar),
      usuarioId: opciones.usuarioId ?? null,
      conDocumento: Boolean(opciones.documento),
    };
    let r = await pedir(datos);
    if (r.estado === "falta-documento") {
      const documento = opciones.documento ? await opciones.documento() : null;
      r = await pedir({ ...datos, conDocumento: Boolean(documento) }, documento);
    }
    return { estado: r.estado === "falta-documento" ? "fallida" : r.estado, detalle: r.detalle };
  } catch (error) {
    console.info(JSON.stringify({ scope: "whatsapp.avisos", evento: "error_inesperado", detalle: error instanceof Error ? error.message : "desconocido" }));
    return { estado: "fallida", detalle: "Error inesperado." };
  }
}

/** El aviso del cambio de estado de un pedido (o del pedido recibido). */
export async function avisarCambioDePedido(orderId: string, nuevoEstado: string): Promise<void> {
  try {
    await apiInterna.POST("/api/v1/interno/whatsapp/aviso-pedido", { body: { orderId, estado: nuevoEstado } });
  } catch (error) {
    console.info(JSON.stringify({ scope: "whatsapp.avisos", evento: "error_inesperado", detalle: error instanceof Error ? error.message : "desconocido" }));
  }
}
