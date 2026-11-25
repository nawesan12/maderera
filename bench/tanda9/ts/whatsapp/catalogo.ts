// @ts-nocheck: copiado tal cual de git 9a17128, ver ../../README.md.
import "server-only";

import { and, asc, eq, notInArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { plantillasWhatsapp } from "@/lib/db/schema";
import { proveedorWhatsapp } from "./index";
import { PLANTILLAS_BASE } from "./plantillas-base";
import { leerPlantilla, type PlantillaLeida } from "./plantillas";

/**
 * Las plantillas, guardadas y listas para ofrecer.
 *
 * Se copian de Meta a `whatsapp_plantillas` y la bandeja lee de ahí: abrir una
 * conversación no puede depender de que la Graph API conteste. La copia se
 * actualiza con el botón de la configuración, con la tarea diaria y cuando Meta
 * avisa por el webhook que una cambió de estado.
 */

export interface ResultadoSincronizacion {
  total?: number;
  aprobadas?: number;
  error?: string;
}

export async function sincronizarPlantillas(): Promise<ResultadoSincronizacion> {
  const proveedor = proveedorWhatsapp();
  if (proveedor.id === "demo") return { error: "En demostración no hay plantillas de Meta para traer." };

  const respuesta = await proveedor.listarPlantillas();
  if ("error" in respuesta) return { error: respuesta.error };

  const ahora = new Date();
  for (const p of respuesta.plantillas) {
    await db
      .insert(plantillasWhatsapp)
      .values({
        metaId: p.metaId,
        nombre: p.nombre,
        idioma: p.idioma,
        categoria: p.categoria,
        estado: p.estado,
        motivoRechazo: p.motivoRechazo,
        formatoParametros: p.formatoParametros,
        componentes: p.componentes,
        sincronizadaAt: ahora,
      })
      .onConflictDoUpdate({
        target: [plantillasWhatsapp.nombre, plantillasWhatsapp.idioma],
        set: {
          metaId: p.metaId,
          categoria: p.categoria,
          estado: p.estado,
          motivoRechazo: p.motivoRechazo,
          formatoParametros: p.formatoParametros,
          componentes: p.componentes,
          sincronizadaAt: ahora,
        },
      });
  }

  // Las que se borraron en Meta dejan de ofrecerse.
  const vigentes = respuesta.plantillas.map((p) => `${p.nombre}|${p.idioma}`);
  await db
    .delete(plantillasWhatsapp)
    .where(
      vigentes.length > 0
        ? notInArray(sql`${plantillasWhatsapp.nombre} || '|' || ${plantillasWhatsapp.idioma}`, vigentes)
        : sql`true`,
    );

  return {
    total: respuesta.plantillas.length,
    aprobadas: respuesta.plantillas.filter((p) => p.estado === "APPROVED").length,
  };
}

/** Lo que avisa el webhook `message_template_status_update`. */
export async function actualizarEstadoPlantilla(evento: {
  nombre: string;
  idioma: string | null;
  estado: string;
  motivo: string | null;
}): Promise<void> {
  const condicion = evento.idioma
    ? and(eq(plantillasWhatsapp.nombre, evento.nombre), eq(plantillasWhatsapp.idioma, evento.idioma))
    : eq(plantillasWhatsapp.nombre, evento.nombre);

  const actualizadas = await db
    .update(plantillasWhatsapp)
    .set({
      estado: evento.estado,
      motivoRechazo: evento.motivo && evento.motivo !== "NONE" ? evento.motivo : null,
      sincronizadaAt: new Date(),
    })
    .where(condicion)
    .returning({ id: plantillasWhatsapp.id });

  // Una que no teníamos (se creó en Meta y recién la aprobaron): se trae entera.
  if (actualizadas.length === 0) await sincronizarPlantillas();
}

export interface PlantillaDisponible extends PlantillaLeida {
  /** Para qué es, si es una de las nuestras. */
  uso: string | null;
}

/**
 * Las plantillas que se pueden mandar ahora.
 *
 * Con la Cloud API, las aprobadas que se sincronizaron. En demostración, el
 * catálogo base, para que se pueda probar el flujo entero.
 */
export async function plantillasDisponibles(): Promise<PlantillaDisponible[]> {
  const usoDe = (nombre: string) => PLANTILLAS_BASE.find((b) => b.nombre === nombre)?.uso ?? null;

  if (proveedorWhatsapp().id === "demo") {
    return PLANTILLAS_BASE.map((p) => ({
      ...leerPlantilla({
        nombre: p.nombre,
        idioma: p.idioma,
        categoria: p.categoria,
        estado: p.estado,
        formato: p.formatoParametros,
        componentes: p.componentes,
      }),
      uso: p.uso,
    }));
  }

  const leer = () =>
    db
      .select()
      .from(plantillasWhatsapp)
      .where(eq(plantillasWhatsapp.estado, "APPROVED"))
      .orderBy(asc(plantillasWhatsapp.nombre));

  let filas = await leer();
  // Recién conectado nunca se sincronizó: se traen la primera vez que hacen
  // falta, en vez de mostrar «no hay plantillas» hasta que alguien toque el
  // botón de la configuración.
  if (filas.length === 0) {
    const [alguna] = await db.select({ id: plantillasWhatsapp.id }).from(plantillasWhatsapp).limit(1);
    if (!alguna) {
      await sincronizarPlantillas();
      filas = await leer();
    }
  }

  return filas.map((f) => ({
    ...leerPlantilla({
      nombre: f.nombre,
      idioma: f.idioma,
      categoria: f.categoria,
      estado: f.estado,
      formato: f.formatoParametros,
      componentes: f.componentes,
    }),
    uso: usoDe(f.nombre),
  }));
}

/** Una plantilla aprobada por nombre (y el idioma, si hay varios). */
export async function plantillaDisponible(nombre: string, idioma?: string | null) {
  const todas = await plantillasDisponibles();
  return (
    todas.find((p) => p.nombre === nombre && (!idioma || p.idioma === idioma)) ??
    todas.find((p) => p.nombre === nombre) ??
    null
  );
}

/** Todas las guardadas, con su estado, para la configuración. */
export async function plantillasGuardadas() {
  return db.select().from(plantillasWhatsapp).orderBy(asc(plantillasWhatsapp.nombre));
}
