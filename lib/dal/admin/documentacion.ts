import "server-only";

import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { technicalDocuments } from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";

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

/** Todos los documentos, incluidos los dados de baja. */
export async function listarDocumentos(): Promise<DocumentoAdmin[]> {
  await requireStaff();

  return db
    .select({
      id: technicalDocuments.id,
      titulo: technicalDocuments.titulo,
      descripcion: technicalDocuments.descripcion,
      categoria: technicalDocuments.categoria,
      url: technicalDocuments.url,
      formato: technicalDocuments.formato,
      tamanoBytes: technicalDocuments.tamanoBytes,
      soloProfesionales: technicalDocuments.soloProfesionales,
      activo: technicalDocuments.activo,
      createdAt: technicalDocuments.createdAt,
    })
    .from(technicalDocuments)
    .orderBy(
      desc(technicalDocuments.activo),
      asc(technicalDocuments.categoria),
      asc(technicalDocuments.titulo),
    );
}

/** Categorías ya usadas, para sugerirlas en vez de que cada uno invente la suya. */
export async function categoriasDeDocumentos(): Promise<string[]> {
  await requireStaff();

  const filas = await db
    .selectDistinct({ categoria: technicalDocuments.categoria })
    .from(technicalDocuments)
    .where(eq(technicalDocuments.activo, true))
    .orderBy(asc(technicalDocuments.categoria));

  return filas.map((f) => f.categoria);
}
