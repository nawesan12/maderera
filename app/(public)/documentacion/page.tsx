import type { Metadata } from "next";
import Link from "next/link";
import { EncabezadoPublico } from "@/components/encabezado-publico";
import { Download, FileText, Lock } from "lucide-react";
import {
  documentosReservados,
  documentosVisibles,
  estadoProfesional,
} from "@/lib/dal/profesionales";

export const metadata: Metadata = {
  title: "Documentación técnica",
  description:
    "Fichas de producto, tablas de carga e instructivos de colocación de maderas, placas y molduras.",
  alternates: { canonical: "/documentacion" },
};

/** Peso legible. Avisar antes de que alguien baje 40 MB con datos móviles. */
function peso(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Biblioteca técnica (cláusula 1.7).
 *
 * Lo que más pide un arquitecto y lo que menos se encuentra: fichas, tablas de
 * carga, instructivos. Parte es pública —sirve para posicionar— y parte está
 * reservada a profesionales aprobados.
 *
 * El filtro por permiso vive en el DAL, dentro de la consulta: acá no hay forma
 * de mostrar de más aunque el JSX se equivoque.
 */
export default async function DocumentacionPage() {
  const [documentos, estado, reservados] = await Promise.all([
    documentosVisibles(),
    estadoProfesional(),
    documentosReservados(),
  ]);

  const porCategoria = new Map<string, typeof documentos>();
  for (const doc of documentos) {
    const grupo = porCategoria.get(doc.categoria) ?? [];
    grupo.push(doc);
    porCategoria.set(doc.categoria, grupo);
  }

  return (
    <div className="min-h-screen bg-sitio-alt">
      <EncabezadoPublico
        titulo="Documentación"
        bajada="Fichas técnicas, tablas de carga e instructivos, listos para adjuntar al pliego."
      />

      <div className="contenedor py-10">
        {!estado.aprobado && reservados > 0 && (
          <div className="mb-8 flex flex-wrap items-center gap-4 rounded-xl border border-brand-orange/20 bg-brand-orange/5 p-5">
            <Lock className="h-5 w-5 shrink-0 text-brand-orange" />
            <p className="min-w-[16rem] flex-1">
              Hay {reservados} documento{reservados === 1 ? "" : "s"} más
              reservado{reservados === 1 ? "" : "s"} para clientes
              profesionales.
            </p>
            <Link
              href="/profesionales"
              className="inline-flex h-11 items-center rounded-lg bg-brand-orange px-5 font-medium text-white transition-colors hover:bg-brand-orange-dark"
            >
              Pedir acceso
            </Link>
          </div>
        )}

        {documentos.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-card/60 px-6 py-16 text-center">
            <FileText className="mx-auto h-10 w-10 text-muted-foreground/60" />
            <h2 className="mt-4 text-xl font-semibold">
              Todavía no hay documentación cargada
            </h2>
            <p className="mx-auto mt-1.5 max-w-md text-muted-foreground">
              Si necesitás la ficha técnica de un producto, escribinos y te la
              mandamos.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {[...porCategoria.entries()].map(([categoria, docs]) => (
              <section key={categoria}>
                <h2 className="mb-3 text-xl font-bold capitalize tracking-tight">
                  {categoria}
                </h2>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {docs.map((doc) => (
                    <li key={doc.id}>
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-start gap-4 rounded-xl border bg-card p-4 transition-shadow hover:shadow-md"
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-orange/10">
                          <FileText className="h-5 w-5 text-brand-orange" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{doc.titulo}</span>
                          {doc.descripcion && (
                            <span className="block text-sm text-muted-foreground">
                              {doc.descripcion}
                            </span>
                          )}
                          <span className="mt-1 block text-sm uppercase text-muted-foreground">
                            {doc.formato}
                            {doc.tamanoBytes ? ` · ${peso(doc.tamanoBytes)}` : ""}
                          </span>
                        </span>
                        <Download className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
