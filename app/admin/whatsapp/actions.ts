"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { api, comoFormulario, mensajeDe, type Problema } from "@/lib/api/servidor";
import { db } from "@/lib/db";
import { customers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { obtenerConversacion, requireBandeja } from "@/lib/dal/admin/whatsapp";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";
import { documentoPdf, esTipoDeDocumento } from "@/lib/whatsapp/documentos";
import { numeroLegible, sinNumero } from "@/lib/whatsapp/numeros";
import { crearClienteRapido } from "@/lib/clientes/alta";
import { leerDocumento, sugerirCondicionIva } from "@/lib/clientes/documento";

/**
 * Las acciones de la bandeja. Las hace la API de Go (backend/internal/whatsapp),
 * que pide el rol de la bandeja y manda todo por EnviarYRegistrar: guarda
 * primero y manda después, y un mensaje que Meta rechaza queda en la
 * conversación como «no se envió», con el motivo y para reintentar.
 *
 * Lo que queda acá es lo que todavía es de otro módulo: los PDF de los papeles
 * (tanda 12), que se arman en Next y viajan a Go en el pedido, y el alta de la
 * ficha desde una conversación (clientes, tanda 4).
 */

export interface EstadoWhatsapp {
  error?: string;
  ok?: string;
  /** Hay que usar plantilla: fuera de la ventana, o Meta lo rechazó por eso. */
  requierePlantilla?: boolean;
  /**
   * Se pasó el tope de gasto del mes: no se mandó. La pantalla ofrece
   * mandarlo igual (vuelve con `confirmarTope=si`) o contestar desde el
   * teléfono, que es gratis.
   */
  requiereConfirmacionTope?: boolean;
}

function refrescar() {
  revalidatePath("/admin/whatsapp");
  revalidatePath("/atencion");
}

/** Lo que contestó Go, como lo espera la pantalla. */
function estado(r: { data?: unknown; error?: unknown; response: Response }): EstadoWhatsapp & { conversacionId?: string } {
  if (!r.response.ok) return { error: mensajeDe(r.error as Problema | undefined) };
  const d = (r.data ?? {}) as EstadoWhatsapp & { conversacionId?: string; mensajeId?: string };
  return {
    ...(d.error ? { error: d.error } : {}),
    ...(d.ok ? { ok: d.ok } : {}),
    ...(d.requierePlantilla ? { requierePlantilla: true } : {}),
    ...(d.requiereConfirmacionTope ? { requiereConfirmacionTope: true } : {}),
    ...(d.conversacionId ? { conversacionId: d.conversacionId } : {}),
  };
}

const texto = (formData: FormData, campo: string) => String(formData.get(campo) ?? "");

/** El PDF de un papel de la plataforma, como parte de un formulario para Go. */
async function conPdf(form: FormData, doc: { tipo: string; id: string }) {
  if (!esTipoDeDocumento(doc.tipo) || !doc.id) return null;
  const pdf = await documentoPdf({ tipo: doc.tipo, id: doc.id });
  if (!pdf) return null;
  form.append("archivo", new Blob([new Uint8Array(pdf.contenido)], { type: "application/pdf" }), pdf.nombre);
  form.append("archivoNombre", pdf.nombre);
  form.append("descripcion", pdf.descripcion);
  return pdf;
}

/** Contesta con texto libre (dentro de la ventana), citando un mensaje si se eligió. */
export async function responder(_previo: EstadoWhatsapp, formData: FormData): Promise<EstadoWhatsapp> {
  const citado = texto(formData, "citado").trim();
  const r = await (await api()).POST("/api/v1/admin/whatsapp/conversaciones/{id}/responder", {
    params: { path: { id: texto(formData, "conversacionId") || "-" } },
    body: { cuerpo: texto(formData, "cuerpo"), ...(citado ? { citado } : {}), confirmarTope: formData.get("confirmarTope") === "si" },
  });
  refrescar();
  return estado(r);
}

/**
 * Manda una plantilla aprobada. Si lleva un PDF en el encabezado, se arma
 * acá (los PDF siguen en Next) y viaja con el pedido.
 */
export async function enviarPlantilla(_previo: EstadoWhatsapp, formData: FormData): Promise<EstadoWhatsapp> {
  await requireBandeja();
  const valores: Record<string, string> = {};
  for (const [clave, valor] of formData) {
    if (clave.startsWith("v:") && typeof valor === "string") valores[clave.slice(2)] = valor;
  }
  const form = new FormData();
  form.append("plantilla", texto(formData, "plantilla"));
  form.append("idioma", texto(formData, "idioma"));
  form.append("valores", JSON.stringify(valores));
  if (formData.get("confirmarTope") === "si") form.append("confirmarTope", "si");
  const elegido = texto(formData, "documento");
  if (elegido) {
    const [tipo, id] = elegido.split(":");
    if (!(await conPdf(form, { tipo, id }))) return { error: "No encontramos ese documento." };
  }
  const r = await (await api()).POST("/api/v1/admin/whatsapp/conversaciones/{id}/plantilla", {
    params: { path: { id: texto(formData, "conversacionId") || "-" } },
    body: form as never,
    ...comoFormulario,
  });
  refrescar();
  return estado(r);
}

/**
 * Manda un papel de la plataforma: presupuesto, factura, remito, recibo,
 * resumen de cuenta o plano de corte. Dentro de la ventana sale como
 * documento con un epígrafe; fuera, con la plantilla que lleva el PDF.
 */
export async function enviarDocumento(_previo: EstadoWhatsapp, formData: FormData): Promise<EstadoWhatsapp> {
  await requireBandeja();
  const tipo = texto(formData, "tipo");
  const id = texto(formData, "id");
  if (!esTipoDeDocumento(tipo)) return { error: "Elegí qué documento mandar." };
  const form = new FormData();
  form.append("tipo", tipo);
  form.append("id", id);
  form.append("epigrafe", texto(formData, "epigrafe").slice(0, 1000));
  if (formData.get("confirmarTope") === "si") form.append("confirmarTope", "si");
  await conPdf(form, { tipo, id });
  const r = await (await api()).POST("/api/v1/admin/whatsapp/conversaciones/{id}/documento", {
    params: { path: { id: texto(formData, "conversacionId") || "-" } },
    body: form as never,
    ...comoFormulario,
  });
  refrescar();
  return estado(r);
}

/**
 * Manda un papel desde su propia pantalla (el remito, el presupuesto…), al
 * teléfono de la ficha. Go abre o reutiliza la conversación de ese número.
 */
export async function enviarDocumentoAlCliente(
  _previo: EstadoWhatsapp,
  formData: FormData,
): Promise<EstadoWhatsapp & { conversacionId?: string }> {
  await requireBandeja();
  const tipo = texto(formData, "tipo");
  const id = texto(formData, "id");
  if (!esTipoDeDocumento(tipo)) return { error: "Documento desconocido." };
  const form = new FormData();
  form.append("tipo", tipo);
  form.append("id", id);
  form.append("telefono", texto(formData, "telefono"));
  if (formData.has("epigrafe")) form.append("epigrafe", texto(formData, "epigrafe"));
  if (formData.get("confirmarTope") === "si") form.append("confirmarTope", "si");
  const pdf = await conPdf(form, { tipo, id });
  if (!pdf) return { error: "No encontramos ese documento." };
  if (pdf.customerId) form.append("customerId", pdf.customerId);
  if (pdf.telefono) form.append("telefonoDelDocumento", pdf.telefono);
  if (pdf.contacto) form.append("contacto", pdf.contacto);
  const r = await (await api()).POST("/api/v1/admin/whatsapp/documento-al-cliente", { body: form as never, ...comoFormulario });
  refrescar();
  return estado(r);
}

/** Vuelve a mandar un mensaje que no salió, tal cual se había pedido. */
export async function reintentarMensaje(mensajeId: string, confirmarTope = false): Promise<EstadoWhatsapp> {
  const r = await (await api()).POST("/api/v1/admin/whatsapp/mensajes/{id}/reintentar", {
    params: { path: { id: mensajeId || "-" } },
    body: { confirmarTope },
  });
  refrescar();
  return estado(r);
}

/** Pone (o saca) un emoji sobre un mensaje del cliente. */
export async function reaccionar(mensajeId: string, emoji: string): Promise<EstadoWhatsapp> {
  const r = await (await api()).POST("/api/v1/admin/whatsapp/mensajes/{id}/reaccion", {
    params: { path: { id: mensajeId || "-" } },
    body: { emoji: emoji.slice(0, 64) },
  });
  refrescar();
  return estado(r);
}

/** Vuelve a intentar bajar un adjunto que no llegó. */
export async function reintentarDescarga(mensajeId: string): Promise<EstadoWhatsapp> {
  const r = await (await api()).POST("/api/v1/admin/whatsapp/mensajes/{id}/descarga", { params: { path: { id: mensajeId || "-" } } });
  refrescar();
  return estado(r);
}

/** Asigna la conversación a alguien del equipo (o la libera). */
export async function asignarConversacion(_previo: EstadoWhatsapp, formData: FormData): Promise<EstadoWhatsapp> {
  const r = await (await api()).POST("/api/v1/admin/whatsapp/conversaciones/{id}/asignar", {
    params: { path: { id: texto(formData, "conversacionId") || "-" } },
    body: { usuarioId: texto(formData, "usuarioId") },
  });
  refrescar();
  return estado(r);
}

/** Marca la conversación como resuelta, o la reabre. */
export async function cambiarEstadoConversacion(_previo: EstadoWhatsapp, formData: FormData): Promise<EstadoWhatsapp> {
  const r = await (await api()).POST("/api/v1/admin/whatsapp/conversaciones/{id}/estado", {
    params: { path: { id: texto(formData, "conversacionId") || "-" } },
    body: { estado: texto(formData, "estado") },
  });
  refrescar();
  return estado(r);
}

/** Busca fichas para vincular una conversación sin cliente. */
export async function buscarClientesParaVincular(textoBuscado: string) {
  const r = await (await api()).GET("/api/v1/admin/whatsapp/clientes", { params: { query: { q: textoBuscado.slice(0, 200) } } });
  return r.data ?? [];
}

/** Vincula la conversación con una ficha existente. */
export async function vincularCliente(_previo: EstadoWhatsapp, formData: FormData): Promise<EstadoWhatsapp> {
  const r = await (await api()).POST("/api/v1/admin/whatsapp/conversaciones/{id}/vincular", {
    params: { path: { id: texto(formData, "conversacionId") || "-" } },
    body: { customerId: texto(formData, "customerId") || null },
  });
  refrescar();
  return estado(r);
}

/**
 * Crea la ficha del cliente desde la conversación, con el teléfono ya puesto.
 * El alta de la ficha es de clientes (sigue en TS hasta su tanda); vincularla
 * a la conversación, de Go.
 */
export async function crearFichaDesdeConversacion(_previo: EstadoWhatsapp, formData: FormData): Promise<EstadoWhatsapp> {
  const usuario = await requireBandeja();
  const id = texto(formData, "conversacionId");
  const conversacion = z.string().uuid().safeParse(id).success ? await obtenerConversacion(id) : null;
  if (!conversacion) return { error: "No encontramos esa conversación." };
  if (conversacion.customerId) return { error: "Esta conversación ya tiene ficha." };

  const nombre = z.string().trim().min(2, "Escribí el nombre.").max(160).safeParse(formData.get("nombre"));
  if (!nombre.success) return { error: nombre.error.issues[0]?.message };

  const documento = leerDocumento(String(formData.get("documento") ?? ""));
  if ("error" in documento) return { error: documento.error };

  const telefono = sinNumero(conversacion.waJid) ? null : numeroLegible(conversacion.waJid);
  const cliente = await crearClienteRapido(db, {
    nombre: nombre.data,
    documento,
    condicionIva: sugerirCondicionIva(documento),
    telefono,
    rubro: (formData.get("rubro") as string) || null,
    notas: "Alta desde una conversación de WhatsApp.",
  });

  const email = z.string().trim().email().safeParse(formData.get("email"));
  if (email.success) await db.update(customers).set({ email: email.data }).where(eq(customers.id, cliente.id));

  const r = await (await api()).POST("/api/v1/admin/whatsapp/conversaciones/{id}/vincular", {
    params: { path: { id } },
    body: { customerId: cliente.id },
  });
  if (!r.response.ok || r.data?.error) return estado(r);

  await registrarEnBitacora({
    sesion: usuario,
    accion: "crear",
    entidad: "cliente",
    entidadId: cliente.id,
    descripcion: `Ficha de ${cliente.nombre} creada desde WhatsApp`,
  });

  refrescar();
  return { ok: `Ficha de ${cliente.nombre} creada.` };
}

/**
 * Da de baja (o de alta) los avisos de un número desde el panel: cuando lo
 * pide por teléfono o en el mostrador. Go deja quién lo cargó.
 */
export async function cambiarBaja(_previo: EstadoWhatsapp, formData: FormData): Promise<EstadoWhatsapp> {
  const r = await (await api()).POST("/api/v1/admin/whatsapp/conversaciones/{id}/baja", {
    params: { path: { id: texto(formData, "conversacionId") || "-" } },
    body: { baja: formData.get("baja") === "si" },
  });
  refrescar();
  return estado(r);
}

/** Empieza una conversación con un número que todavía no escribió. */
export async function abrirConversacion(
  _previo: EstadoWhatsapp & { conversacionId?: string },
  formData: FormData,
): Promise<EstadoWhatsapp & { conversacionId?: string }> {
  const r = await (await api()).POST("/api/v1/admin/whatsapp/conversaciones", {
    body: { telefono: texto(formData, "telefono").slice(0, 100) },
  });
  refrescar();
  return estado(r);
}

/**
 * Simula que un cliente escribe. Solo en modo demostración: entra por la
 * misma ingesta que el webhook (incluido el «BAJA»). Con el simulador de
 * Meta conviene usar `scripts/whatsapp-webhook.ts`, que además firma el
 * payload.
 */
export async function simularEntrante(_previo: EstadoWhatsapp, formData: FormData): Promise<EstadoWhatsapp> {
  const r = await (await api()).POST("/api/v1/admin/whatsapp/conversaciones/{id}/simular", {
    params: { path: { id: texto(formData, "conversacionId") || "-" } },
    body: { cuerpo: texto(formData, "cuerpo") },
  });
  refrescar();
  return estado(r);
}
