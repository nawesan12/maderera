"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { avisosWhatsapp, sesionWhatsapp } from "@/lib/db/schema";
import { requireStaffRole } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";
import { proveedorWhatsapp } from "@/lib/whatsapp";
import { plantillaDisponible, sincronizarPlantillas } from "@/lib/whatsapp/catalogo";
import { aJid } from "@/lib/whatsapp/config";
import { enviarYRegistrar } from "@/lib/whatsapp/envio";
import { conversacionDe } from "@/lib/whatsapp/ingesta";
import { armarComponentes, sugerirValores, vistaPrevia } from "@/lib/whatsapp/plantillas";
import { ventanaAbierta } from "@/lib/whatsapp/ventana";

export interface EstadoAviso {
  error?: string;
  ok?: string;
}

/**
 * Prende o apaga un aviso automático.
 *
 * Solo administración: cada aviso que se prende le manda mensajes a todos los
 * clientes que lleguen a ese estado, y cada uno se cobra. No es una
 * preferencia de pantalla.
 */
export async function cambiarAviso(_previo: EstadoAviso, formData: FormData): Promise<EstadoAviso> {
  const usuario = await requireStaffRole("admin");

  const parsed = z
    .object({ id: z.string().uuid(), activo: z.enum(["si", "no"]) })
    .safeParse({ id: formData.get("id"), activo: formData.get("activo") });
  if (!parsed.success) return { error: "No pudimos cambiar el aviso." };

  const [aviso] = await db
    .update(avisosWhatsapp)
    .set({ activo: parsed.data.activo === "si", updatedAt: new Date() })
    .where(eq(avisosWhatsapp.id, parsed.data.id))
    .returning({ evento: avisosWhatsapp.evento });

  await registrarEnBitacora({
    sesion: usuario,
    accion: "editar",
    entidad: "whatsapp",
    entidadId: parsed.data.id,
    descripcion: `Aviso de WhatsApp «${aviso?.evento}» ${parsed.data.activo === "si" ? "encendido" : "apagado"}`,
  });

  revalidatePath("/admin/whatsapp/configuracion");
  return { ok: parsed.data.activo === "si" ? "Aviso activado." : "Aviso desactivado." };
}

/** Edita el texto que se manda dentro de la ventana de 24 h. */
export async function guardarTextoAviso(_previo: EstadoAviso, formData: FormData): Promise<EstadoAviso> {
  await requireStaffRole("admin");

  const parsed = z
    .object({ id: z.string().uuid(), textoLibre: z.string().trim().max(1000) })
    .safeParse({ id: formData.get("id"), textoLibre: formData.get("textoLibre") });
  if (!parsed.success) return { error: "Revisá el texto." };

  await db
    .update(avisosWhatsapp)
    .set({ textoLibre: parsed.data.textoLibre || null, updatedAt: new Date() })
    .where(eq(avisosWhatsapp.id, parsed.data.id));

  revalidatePath("/admin/whatsapp/configuracion");
  return { ok: "Texto guardado." };
}

/** Trae las plantillas de Meta. */
export async function sincronizar(): Promise<EstadoAviso> {
  await requireStaffRole("admin");
  const resultado = await sincronizarPlantillas();
  revalidatePath("/admin/whatsapp/configuracion");
  if (resultado.error) return { error: resultado.error };
  return { ok: `Listo: ${resultado.total} plantillas, ${resultado.aprobadas} aprobadas.` };
}

/** El chequeo de la configuración contra Meta. Se guarda para mostrarlo después. */
export async function diagnosticar(): Promise<EstadoAviso> {
  await requireStaffRole("admin");
  const diagnostico = await proveedorWhatsapp().diagnosticar();
  const ahora = new Date();
  const valores = {
    diagnostico: diagnostico as unknown as Record<string, unknown>,
    diagnosticoAt: ahora,
    calidad: diagnostico.numero?.calidad ?? null,
    limiteMensajes: diagnostico.numero?.limite ?? null,
    updatedAt: ahora,
  };
  const actualizadas = await db.update(sesionWhatsapp).set(valores).returning({ id: sesionWhatsapp.id });
  if (actualizadas.length === 0) await db.insert(sesionWhatsapp).values(valores);

  revalidatePath("/admin/whatsapp/configuracion");
  const errores = diagnostico.puntos.filter((p) => p.estado === "error").length;
  return errores ? { error: `Hay ${errores} ${errores === 1 ? "cosa" : "cosas"} para arreglar.` } : { ok: "Todo en orden." };
}

/**
 * Manda un mensaje de prueba a un número.
 *
 * Si ese número escribió en las últimas 24 h, sale como texto. Si no, con la
 * plantilla `hello_world` que Meta crea en toda cuenta nueva, o con la
 * primera aprobada que haya: es lo único que se le puede mandar a alguien
 * que no escribió.
 */
export async function mensajeDePrueba(_previo: EstadoAviso, formData: FormData): Promise<EstadoAviso> {
  const usuario = await requireStaffRole("admin");

  const telefono = String(formData.get("telefono") ?? "").trim();
  const waJid = aJid(telefono);
  if (!waJid) return { error: "Escribí un número válido, con característica." };

  const conversacion = await conversacionDe(waJid);
  const abierta = ventanaAbierta(conversacion.ultimoEntranteAt);

  let resultado;
  if (abierta) {
    const cuerpo = "Mensaje de prueba de la plataforma de Maderera Juan B. Justo. Si lo ves, WhatsApp está conectado.";
    resultado = await enviarYRegistrar({
      conversacionId: conversacion.id,
      waJid,
      mensaje: { tipo: "texto", cuerpo },
      registro: { cuerpo },
      origen: "panel",
      enviadoPorUserId: usuario.userId,
    });
  } else {
    const plantilla =
      (await plantillaDisponible("hello_world", "en_US")) ??
      (await plantillaDisponible("retomar_conversacion")) ??
      null;
    if (!plantilla) {
      return { error: "No hay ninguna plantilla aprobada para probar. Sincronizá las plantillas o escribile primero desde ese número." };
    }
    const valores = sugerirValores(plantilla, { nombre: usuario.name.split(" ")[0] });
    resultado = await enviarYRegistrar({
      conversacionId: conversacion.id,
      waJid,
      mensaje: { tipo: "plantilla", nombre: plantilla.nombre, idioma: plantilla.idioma, componentes: armarComponentes(plantilla, valores) },
      registro: { cuerpo: vistaPrevia(plantilla, valores), plantilla: plantilla.nombre },
      origen: "panel",
      enviadoPorUserId: usuario.userId,
    });
  }

  revalidatePath("/admin/whatsapp/configuracion");
  if (resultado.error) return { error: resultado.error.texto };
  return {
    ok: `Enviado${abierta ? "" : " con plantilla"}. Fijate en la bandeja cómo cambia el estado (enviado, entregado, leído).`,
  };
}
