import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock } from "lucide-react";
import {
  articuloPorSlug,
  articulosRelacionados,
} from "@/lib/dal/contenido";
import { markdownAHtml, markdownATexto } from "@/lib/markdown";
import { fechaLarga } from "@/lib/formato";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const articulo = await articuloPorSlug(slug);

  if (!articulo) return { title: "Nota no encontrada" };

  const descripcion =
    articulo.metaDescripcion ||
    articulo.resumen ||
    markdownATexto(articulo.contenido);

  return {
    title: articulo.metaTitulo || articulo.titulo,
    description: descripcion,
    alternates: { canonical: `/blog/${slug}` },
    openGraph: {
      type: "article",
      title: articulo.titulo,
      description: descripcion,
      publishedTime: articulo.publicadoAt?.toISOString(),
      images: articulo.imagenUrl ? [{ url: articulo.imagenUrl }] : undefined,
    },
  };
}

/**
 * Una nota del blog.
 *
 * Server Component: el contenido no cambia entre visitantes y no hay nada que
 * interactuar, así que mandarlo como JavaScript al navegador era trabajo de más
 * para el visitante y contenido que el buscador tenía que ejecutar para ver.
 *
 * Los datos estructurados de `Article` van en la página y no en el layout
 * porque dependen de la nota: es lo que hace que el resultado en Google muestre
 * la fecha y el autor.
 */
export default async function NotaPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const articulo = await articuloPorSlug(slug);

  if (!articulo) notFound();

  const relacionados = await articulosRelacionados(
    slug,
    articulo.categoriaSlug,
  );

  const datosEstructurados = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: articulo.titulo,
    description: articulo.resumen,
    datePublished: articulo.publicadoAt?.toISOString(),
    author: {
      "@type": "Organization",
      name: articulo.autor ?? "Maderera Juan B. Justo",
    },
    publisher: {
      "@type": "Organization",
      name: "Maderera Juan B. Justo",
    },
    ...(articulo.imagenUrl ? { image: articulo.imagenUrl } : {}),
  };

  return (
    <div className="min-h-screen bg-brand-cream/30">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(datosEstructurados) }}
      />

      <article className="mx-auto px-6 max-w-3xl py-8">
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver al blog
        </Link>

        <header className="mt-6">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {articulo.categoria && (
              <Link
                href={`/blog?categoria=${articulo.categoriaSlug}`}
                className="rounded-full bg-brand-orange/10 px-2.5 py-0.5 font-medium text-brand-orange-dark hover:underline"
              >
                {articulo.categoria}
              </Link>
            )}
            {articulo.publicadoAt && (
              <time dateTime={articulo.publicadoAt.toISOString()}>
                {fechaLarga.format(articulo.publicadoAt)}
              </time>
            )}
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              {articulo.minutosLectura} min de lectura
            </span>
          </p>

          <h1 className="mt-3 text-4xl font-bold leading-tight tracking-tight">
            {articulo.titulo}
          </h1>

          {articulo.resumen && (
            <p className="mt-3 text-lg text-muted-foreground">
              {articulo.resumen}
            </p>
          )}
        </header>

        {articulo.imagenUrl && (
          <div className="relative mt-8 aspect-[16/9] overflow-hidden rounded-xl bg-muted">
            <Image
              src={articulo.imagenUrl}
              alt=""
              fill
              sizes="(max-width: 768px) 100vw, 768px"
              className="object-cover"
              priority
            />
          </div>
        )}

        {/* El HTML sale de `markdownAHtml`, que escapa el contenido antes de
            formatearlo: una nota con etiquetas en el cuerpo se lee como texto. */}
        <div
          className="nota-cuerpo mt-8"
          dangerouslySetInnerHTML={{ __html: markdownAHtml(articulo.contenido) }}
        />

        <footer className="mt-12 border-t pt-8">
          <div className="rounded-xl border border-brand-orange/20 bg-brand-orange/5 p-6 text-center">
            <h2 className="text-xl font-bold">
              ¿Necesitás el material para tu obra?
            </h2>
            <p className="mx-auto mt-1.5 max-w-lg text-muted-foreground">
              Armá tu presupuesto en el catálogo o escribinos y te asesoramos.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              <Link
                href="/catalogo"
                className="inline-flex h-11 items-center rounded-lg bg-brand-orange px-5 font-medium text-white transition-colors hover:bg-brand-orange-dark"
              >
                Ver el catálogo
              </Link>
              <Link
                href="/calculadora"
                className="inline-flex h-11 items-center rounded-lg border bg-white px-5 font-medium transition-colors hover:bg-muted"
              >
                Calcular materiales
              </Link>
            </div>
          </div>
        </footer>
      </article>

      {relacionados.length > 0 && (
        <section className="mx-auto px-6 max-w-5xl pb-12">
          <h2 className="mb-4 text-xl font-bold tracking-tight">
            Seguí leyendo
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {relacionados.map((otro) => (
              <Link
                key={otro.id}
                href={`/blog/${otro.slug}`}
                className="rounded-xl border bg-white p-5 transition-shadow hover:shadow-md"
              >
                <p className="text-sm text-muted-foreground">
                  {otro.categoria}
                </p>
                <h3 className="mt-1 font-semibold leading-snug">
                  {otro.titulo}
                </h3>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
