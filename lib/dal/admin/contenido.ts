import "server-only";

import { api, datos } from "@/lib/api/servidor";

/**
 * Lo que lee el panel de contenido. Lo sirve la API de Go
 * (backend/internal/contenido), que exige el rol de quien puede abrir
 * /admin/contenido.
 */

const fecha = (v: string) => new Date(v);
const fechaONull = (v: string | null) => (v ? new Date(v) : null);

export async function listarAjustes() {
  const filas = datos(await (await api()).GET("/api/v1/admin/contenido/ajustes"));
  return filas.map((f) => ({ ...f, updatedAt: fecha(f.updatedAt) }));
}

export interface ResenaParaModerar {
  id: string;
  producto: string;
  productoSlug: string;
  nombre: string;
  estrellas: number;
  texto: string;
  estado: "pendiente" | "publicada" | "rechazada";
  motivoRechazo: string | null;
  numeroPedido: string;
  createdAt: Date;
}

/** Las reseñas, primero las pendientes. */
export async function listarResenas(): Promise<ResenaParaModerar[]> {
  const filas = datos(await (await api()).GET("/api/v1/admin/contenido/resenas"));
  return filas.map((f) => ({ ...f, createdAt: fecha(f.createdAt) }));
}

/** Todos los banners, por ubicación y orden. */
export async function listarBannersDelPanel() {
  const filas = datos(await (await api()).GET("/api/v1/admin/contenido/banners"));
  return filas.map((f) => ({
    ...f,
    desde: fechaONull(f.desde),
    hasta: fechaONull(f.hasta),
    createdAt: fecha(f.createdAt),
    updatedAt: fecha(f.updatedAt),
  }));
}

/** Todas las promociones bancarias. */
export async function listarPromosDelPanel() {
  const filas = datos(await (await api()).GET("/api/v1/admin/contenido/promos"));
  return filas.map((f) => ({
    ...f,
    vigenciaHasta: fechaONull(f.vigenciaHasta),
    createdAt: fecha(f.createdAt),
    updatedAt: fecha(f.updatedAt),
  }));
}

/**
 * Una fecha para un `<input type="date">`, en el día de Buenos Aires: con
 * toISOString (UTC) una promo que vence a las 23:59 de acá se mostraba con el
 * día siguiente.
 */
export function fechaParaInput(f: Date | null): string {
  return f ? f.toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }) : "";
}
