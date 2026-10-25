import "server-only";

import { api, datos } from "@/lib/api/servidor";

/**
 * Lo que lee el panel de documentación técnica. Lo sirve la API de Go
 * (backend/internal/contenido/documentos.go), con el permiso de quien puede
 * abrir /admin/documentacion.
 */

export interface DocumentoAdmin {
  id: string;
  titulo: string;
  descripcion: string | null;
  categoria: string;
  url: string;
  formato: string;
  tamanoBytes: number | null;
  soloProfesionales: boolean;
  activo: boolean;
  createdAt: Date;
}

/** Todos, primero los activos, por categoría y título. */
export async function listarDocumentos(): Promise<DocumentoAdmin[]> {
  const filas = datos(await (await api()).GET("/api/v1/admin/documentos"));
  return filas.map((f) => ({ ...f, createdAt: new Date(f.createdAt) }));
}

/** Las categorías en uso, para sugerirlas al subir. */
export async function categoriasDeDocumentos(): Promise<string[]> {
  return datos(await (await api()).GET("/api/v1/admin/documentos/categorias"));
}
