import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { listarGuias, obtenerGuia } from "@/lib/guias";
import { requireStaff } from "@/lib/dal/session";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const guia = await obtenerGuia(slug);
  return { title: guia ? `${guia.titulo} · Ayuda` : "Ayuda" };
}

/**
 * Una guía.
 *
 * Al pie van la anterior y la siguiente, en el orden en que están pensadas para
 * leerse: quien recién arranca las recorre de punta a punta, y quien viene a
 * consultar algo puntual entra por el buscador y no las ve.
 */
export default async function GuiaPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await requireStaff();

  const { slug } = await params;
  const [guia, todas] = await Promise.all([obtenerGuia(slug), listarGuias()]);

  if (!guia) notFound();

  const posicion = todas.findIndex((g) => g.slug === guia.slug);
  const anterior = posicion > 0 ? todas[posicion - 1] : null;
  const siguiente = posicion < todas.length - 1 ? todas[posicion + 1] : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/admin/ayuda"
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
        Todas las guías
      </Link>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{guia.titulo}</h1>
        <p className="mt-1 text-base text-muted-foreground">{guia.resumen}</p>
      </header>

      {/* El HTML sale de `markdownAHtml`, que escapa el contenido antes de
          formatearlo. Acá además el origen es un archivo del repo. */}
      <article
        className="nota-cuerpo"
        dangerouslySetInnerHTML={{ __html: guia.html }}
      />

      <nav className="grid gap-3 border-t pt-6 sm:grid-cols-2">
        {anterior ? (
          <Link
            href={`/admin/ayuda/${anterior.slug}`}
            className="tarjeta tarjeta-activa flex items-center gap-3 p-4"
          >
            <ArrowLeft className="h-5 w-5 shrink-0 text-muted-foreground" />
            <span>
              <span className="block text-sm text-muted-foreground">Anterior</span>
              <span className="text-base font-medium">{anterior.titulo}</span>
            </span>
          </Link>
        ) : (
          <span />
        )}

        {siguiente && (
          <Link
            href={`/admin/ayuda/${siguiente.slug}`}
            className="tarjeta tarjeta-activa flex items-center justify-end gap-3 p-4 text-right"
          >
            <span>
              <span className="block text-sm text-muted-foreground">Siguiente</span>
              <span className="text-base font-medium">{siguiente.titulo}</span>
            </span>
            <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground" />
          </Link>
        )}
      </nav>
    </div>
  );
}
