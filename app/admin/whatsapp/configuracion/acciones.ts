"use server";

import { revalidatePath, updateTag } from "next/cache";
import { ETIQUETAS } from "@/lib/cache-publico";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";
import { CATEGORIAS_COBRO } from "@/lib/whatsapp/costos";

/**
 * Las acciones de la configuración de WhatsApp. Las hace la API de Go
 * (backend/internal/whatsapp), solo para administración: cada aviso que se
 * prende le manda mensajes a todos los clientes que lleguen a ese estado, y
 * cada uno se cobra.
 */

export interface EstadoAviso {
  error?: string;
  ok?: string;
}

function estado(r: { data?: { error?: string; ok?: string }; error?: unknown; response: Response }): EstadoAviso {
  if (!r.response.ok) return { error: mensajeDe(r.error as Problema | undefined) };
  return { ...(r.data?.error ? { error: r.data.error } : {}), ...(r.data?.ok ? { ok: r.data.ok } : {}) };
}

/** Prende o apaga un aviso automático. */
export async function cambiarAviso(_previo: EstadoAviso, formData: FormData): Promise<EstadoAviso> {
  const r = await (await api()).POST("/api/v1/admin/whatsapp/avisos/{id}", {
    params: { path: { id: String(formData.get("id") ?? "") || "-" } },
    body: { activo: formData.get("activo") === "si" },
  });
  revalidatePath("/admin/whatsapp/configuracion");
  return estado(r);
}

/** Edita el texto que se manda dentro de la ventana de 24 h. */
export async function guardarTextoAviso(_previo: EstadoAviso, formData: FormData): Promise<EstadoAviso> {
  const r = await (await api()).POST("/api/v1/admin/whatsapp/avisos/{id}/texto", {
    params: { path: { id: String(formData.get("id") ?? "") || "-" } },
    body: { textoLibre: String(formData.get("textoLibre") ?? "") },
  });
  revalidatePath("/admin/whatsapp/configuracion");
  return estado(r);
}

/** Trae las plantillas de Meta. */
export async function sincronizar(): Promise<EstadoAviso> {
  const r = await (await api()).POST("/api/v1/admin/whatsapp/plantillas/sincronizar");
  revalidatePath("/admin/whatsapp/configuracion");
  return estado(r);
}

/** El chequeo de la configuración contra Meta. Go lo guarda para mostrarlo después. */
export async function diagnosticar(): Promise<EstadoAviso> {
  const r = await (await api()).POST("/api/v1/admin/whatsapp/diagnostico");
  revalidatePath("/admin/whatsapp/configuracion");
  return estado(r);
}

/**
 * Manda un mensaje de prueba a un número: texto si escribió en las últimas
 * 24 h; si no, `hello_world` o la primera aprobada que sirva.
 */
export async function mensajeDePrueba(_previo: EstadoAviso, formData: FormData): Promise<EstadoAviso> {
  const r = await (await api()).POST("/api/v1/admin/whatsapp/prueba", {
    body: { telefono: String(formData.get("telefono") ?? "").slice(0, 100) },
  });
  revalidatePath("/admin/whatsapp/configuracion");
  return estado(r);
}

/**
 * Guarda el tope del mes y las tarifas de Meta. Si el tope cambia, los avisos
 * de 80 % y 100 % se vuelven a evaluar.
 */
export async function guardarTope(_previo: EstadoAviso, formData: FormData): Promise<EstadoAviso> {
  const campo = (k: string) => String(formData.get(k) ?? "").slice(0, 40);
  const [utility, service, marketing, authentication] = CATEGORIAS_COBRO.map(campo);
  const r = await (await api()).POST("/api/v1/admin/whatsapp/tope", {
    body: { tope: campo("tope"), utility, service, marketing, authentication },
  });
  revalidatePath("/admin/whatsapp/configuracion");
  revalidatePath("/admin/whatsapp");
  return estado(r);
}

/**
 * El bot: encendido o apagado, el número al que deriva y el tope de mensajes
 * del mes. Son ajustes del sitio (migraciones 00096 y 00106); Go los lee en
 * cada mensaje que entra.
 */
async function guardarAjusteDelBot(
  clave: "whatsapp_bot" | "whatsapp_numero_humano" | "whatsapp_tope_mensajes",
  valor: string,
): Promise<EstadoAviso> {
  const r = await (await api()).PUT("/api/v1/admin/contenido/ajustes/{clave}", {
    params: { path: { clave } },
    body: { valor },
  });
  if (r.error) return { error: mensajeDe(r.error as Problema, "No se pudo guardar.") };
  updateTag(ETIQUETAS.ajustes);
  revalidatePath("/admin/whatsapp/configuracion");
  revalidatePath("/admin/whatsapp");
  return { ok: "Listo." };
}

/** Cuántos mensajes pueden salir en el mes, entre el bot y las personas. */
export async function guardarTopeMensajes(_previo: EstadoAviso, formData: FormData): Promise<EstadoAviso> {
  const texto = String(formData.get("tope") ?? "").replace(/\D/g, "");
  const tope = Number(texto);
  if (!texto || !Number.isSafeInteger(tope) || tope > 1_000_000) {
    return { error: "Poné un número de mensajes: 1000, por ejemplo." };
  }
  // Un tope de 0 dejaba «0 de 0» y el bot callado sin decirlo (M2S1-050):
  // para que no conteste está el interruptor.
  if (tope === 0) return { error: "Tiene que ser más de 0. Para que el bot no conteste, apagalo." };
  return guardarAjusteDelBot("whatsapp_tope_mensajes", String(tope));
}

/**
 * El tope del mes en un solo formulario (M2S1-050): los mensajes del bot y
 * los dólares de la API con sus tarifas. Primero los mensajes: si no valen,
 * no se toca nada.
 */
export async function guardarTopes(previo: EstadoAviso, formData: FormData): Promise<EstadoAviso> {
  const mensajes = new FormData();
  mensajes.set("tope", String(formData.get("topeMensajes") ?? ""));
  const m = await guardarTopeMensajes(previo, mensajes);
  if (m.error) return m;
  return guardarTope(previo, formData);
}

export async function cambiarBot(encender: boolean): Promise<EstadoAviso> {
  return guardarAjusteDelBot("whatsapp_bot", encender ? "si" : "no");
}

export async function guardarNumeroHumano(_previo: EstadoAviso, formData: FormData): Promise<EstadoAviso> {
  const numero = String(formData.get("numero") ?? "").replace(/\D/g, "");
  if (numero && (numero.length < 10 || numero.length > 15)) {
    return { error: "Escribilo con código de país y de área: 549 223 …" };
  }
  return guardarAjusteDelBot("whatsapp_numero_humano", numero);
}

/** Le devuelve al bot una conversación que había pasado a una persona. */
export async function devolverAlBot(id: string): Promise<EstadoAviso> {
  const r = await (await api()).POST("/api/v1/admin/whatsapp/conversaciones/{id}/bot", { params: { path: { id } } });
  revalidatePath("/admin/whatsapp");
  return estado(r);
}
