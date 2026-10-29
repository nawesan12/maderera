import "server-only";

import { cache } from "react";
import { cacheLife, cacheTag } from "next/cache";
import { cachearPublico, ETIQUETAS } from "@/lib/cache-publico";
import { api, apiPublica, datos } from "@/lib/api/servidor";

/**
 * Lecturas del portal de profesionales, del lado público.
 *
 * La pregunta central —"¿esta persona es profesional aprobado?"— se responde
 * acá y en un solo lugar, porque de ella dependen los precios que ve, la
 * documentación que puede bajar y a qué eventos se puede anotar. Repetir el
 * criterio en cada pantalla es cómo se filtran precios mayoristas al público.
 */

export interface EstadoProfesional {
  /** Aprobado: ficha de cliente marcada como profesional y activa. */
  aprobado: boolean;
  customerId: string | null;
  nombre: string | null;
  /** Lista de precios asignada, si tiene una propia. */
  priceListId: string | null;
  nombreLista: string | null;
  limiteCredito: number;
  /** Solicitud en curso, si mandó una y todavía no se resolvió. */
  solicitud: {
    id: string;
    estado: "pendiente" | "aprobada" | "rechazada";
    motivoRechazo: string | null;
    createdAt: Date;
  } | null;
}

/**
 * En qué situación está quien mira la página. Lo responde la API de Go
 * (backend/internal/profesionales, `Estado`): el mismo criterio que usa para
 * los documentos y los precios.
 *
 * Memoizado con `cache()` para toda la request: lo consultan la página, el
 * catálogo y el carrito, y sería el mismo pedido tres veces.
 */
export const estadoProfesional = cache(async (): Promise<EstadoProfesional> => {
  const e = datos(await (await api()).GET("/api/v1/profesionales/estado"));
  return { ...e, solicitud: e.solicitud ? { ...e.solicitud, createdAt: new Date(e.solicitud.createdAt) } : null };
});

export interface DocumentoTecnico {
  id: string;
  titulo: string;
  descripcion: string | null;
  categoria: string;
  url: string;
  formato: string;
  tamanoBytes: number | null;
  soloProfesionales: boolean;
}

/**
 * Documentación técnica que esta persona puede ver.
 *
 * El filtro por permiso va **dentro de la consulta**, no después: listar todo y
 * filtrar en la pantalla ya sería haber leído lo que no corresponde, y basta un
 * descuido en el JSX para que se muestre.
 */
/*
 * Acá vivía `escalasDeVolumenPublicas`, que traía las escalas de descuento por
 * volumen para anunciarlas en la portada.
 *
 * **Se borró porque el negocio no da descuentos por volumen.** Lo dijo la
 * clienta con todas las letras, y una función que existe para publicar una
 * promesa que nadie va a cumplir en el mostrador no se deja «por las dudas»:
 * la próxima persona que la encuentre la vuelve a enchufar.
 */

export async function documentosVisibles(): Promise<DocumentoTecnico[]> {
  return datos(await (await api()).GET("/api/v1/contenido/documentos"));
}

/** Cuántos documentos hay reservados para profesionales, sin mostrar cuáles. */
export async function documentosReservados(): Promise<number> {
  return datos(await apiPublica.GET("/api/v1/contenido/documentos/reservados"));
}

export interface EventoPublico {
  id: string;
  slug: string;
  titulo: string;
  resumen: string | null;
  imagenUrl: string | null;
  lugar: string | null;
  inicia: Date;
  termina: Date | null;
  cupo: number;
  precio: number;
  soloProfesionales: boolean;
  /** Inscripciones que ocupan lugar: reservadas y confirmadas. */
  inscriptos: number;
}

/**
 * Eventos publicados que todavía no pasaron.
 *
 * Va al caché compartido aunque traiga el conteo de inscriptos, que sí cambia:
 * el número de acá es para mostrar —"quedan tres lugares"—, y quien decide si
 * hay lugar es `inscribir()`, que cuenta dentro de la transacción. Lo peor que
 * puede pasar es que la pantalla diga un lugar de más por un rato; sobrevender
 * no puede pasar. La inscripción invalida la etiqueta igual, así que el rato es
 * corto.
 */
const eventosCacheados = cachearPublico(
  async () => datos(await apiPublica.GET("/api/v1/contenido/eventos")),
  ["eventos-proximos"],
  ETIQUETAS.eventos,
);

export async function eventosProximos(): Promise<EventoPublico[]> {
  // El caché guarda JSON: las fechas vuelven como texto.
  return (await eventosCacheados()).map(conFechas);
}

function conFechas<T extends { inicia: string; termina: string | null }>(e: T) {
  return { ...e, inicia: new Date(e.inicia), termina: e.termina ? new Date(e.termina) : null };
}

export interface EventoConDetalle extends EventoPublico {
  descripcion: string | null;
  /** Si quien mira ya está anotado. */
  miInscripcion: { id: string; estado: string } | null;
  /**
   * Si el evento ya pasó.
   *
   * Lo resuelve el DAL y no la pantalla porque depende de la hora actual, y
   * leerla durante el render de un Server Component es una impureza.
   */
  yaPaso: boolean;
}

export async function eventoPorSlug(slug: string): Promise<EventoConDetalle | null> {
  const r = await (await api()).GET("/api/v1/contenido/eventos/{slug}", { params: { path: { slug } } });
  if (r.response.status === 404) return null;
  return conFechas(datos(r));
}

/**
 * Si un evento se puede mostrar, desde la caché.
 *
 * Existe aparte de `eventoPorSlug` —que trae los cupos en vivo y la
 * inscripción de quien mira— para que la ficha decida el 404 **antes** de
 * mandar nada: con Cache Components, lo que se resuelve después de un
 * `<Suspense>` ya no puede cambiar el código de estado. La misma regla que
 * `eventoPorSlug`: un borrador no existe para el público.
 */
export async function eventoVisible(slug: string): Promise<boolean> {
  "use cache";
  cacheTag(ETIQUETAS.eventos);
  cacheLife("hours");

  return datos(await apiPublica.GET("/api/v1/contenido/eventos/{slug}/visible", { params: { path: { slug } } }));
}

/** Algunos eventos visibles, para la muestra del build (ver la ficha). */
export async function slugsDeEventosVisibles(limite: number): Promise<string[]> {
  return datos(await apiPublica.GET("/api/v1/contenido/eventos-visibles", { params: { query: { limite } } }));
}
