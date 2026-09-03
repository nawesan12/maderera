import type { Metadata } from "next";
import Link from "next/link";
import { EncabezadoPublico } from "@/components/encabezado-publico";
import Image from "next/image";
import { BookOpen, Clock, Search } from "lucide-react";
import {
  categoriasDelBlog,
  listarArticulos,
  type ArticuloListado,
} from "@/lib/dal/contenido";
import { fechaLarga } from "@/lib/formato";

export const metadata: Metadata = {
  title: "Blog y novedades",
  description:
    "Guías, consejos técnicos y novedades sobre maderas, placas, techos, decks y construcción en seco, escritas por Maderera Juan B. Justo.",
  alternates: { canonical: "/blog" },
};

/**
 * Blog.
 *
 * Era una pantalla de cliente entera que filtraba en memoria seis artículos
 * escritos como constantes de TypeScript: publicar una nota costaba un deploy.
 * Ahora es un Server Component y el filtro va por URL, que además es lo que
 * permite compartir el enlace de una categoría y que Google la indexe.
 */
export default async function BlogPage({
  searchParams,
}: {
  searchParams: Promise<{ categoria?: string; q?: string }>;
}) {
  const { categoria, q } = await searchParams;

  const [articulos, categorias] = await Promise.all([
    listarArticulos({ categoria, busqueda: q }),
    categoriasDelBlog(),
  ]);

  const [principal, ...resto] = articulos;

  return (
    <div className="min-h-screen bg-sitio-alt">
      <EncabezadoPublico
        titulo="Blog"
        bajada="Guías y consejos del oficio: qué material conviene, cómo calcularlo y cómo colocarlo."
      />

      <div className="contenedor py-8">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center">
          {/* Un `form` con GET y sin JavaScript: el buscador funciona igual
              antes de que hidrate la página, y el resultado queda en una URL
              que se puede compartir. */}
          <form method="get" className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              name="q"
              defaultValue={q ?? ""}
              placeholder="Buscar artículos…"
              aria-label="Buscar en el blog"
              className="h-11 w-full rounded-lg border bg-white pl-10 pr-3 text-base"
            />
            {categoria && (
              <input type="hidden" name="categoria" value={categoria} />
            )}
          </form>

          <div className="flex flex-wrap gap-2">
            <Filtro href="/blog" activo={!categoria}>
              Todos
            </Filtro>
            {categorias.map((c) => (
              <Filtro
                key={c.slug}
                href={`/blog?categoria=${c.slug}`}
                activo={categoria === c.slug}
              >
                {c.nombre}
              </Filtro>
            ))}
          </div>
        </div>

        {articulos.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-white/60 px-6 py-16 text-center">
            <BookOpen className="mx-auto h-10 w-10 text-muted-foreground/60" />
            <h2 className="mt-4 text-xl font-semibold">
              {q ? "Nada coincide con tu búsqueda" : "Todavía no hay artículos"}
            </h2>
            <p className="mx-auto mt-1.5 max-w-md text-muted-foreground">
              {q
                ? "Probá con otras palabras o mirá todas las notas."
                : "Estamos preparando las primeras notas."}
            </p>
            {q && (
              <Link
                href="/blog"
                className="mt-5 inline-flex h-11 items-center rounded-lg border bg-white px-5 font-medium transition-colors hover:bg-muted"
              >
                Ver todas
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-8">
            {/* La primera nota va grande: en un blog con pocas entradas,
                todas iguales se leen como una lista de enlaces. */}
            {principal && !q && <Destacado articulo={principal} />}

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {(q ? articulos : resto).map((articulo) => (
                <Tarjeta key={articulo.id} articulo={articulo} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Filtro({
  href,
  activo,
  children,
}: {
  href: string;
  activo: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={activo ? "page" : undefined}
      className={`inline-flex h-11 items-center rounded-lg px-4 text-sm font-medium transition-colors ${
        activo
          ? "bg-brand-orange text-white"
          : "border bg-white hover:bg-muted"
      }`}
    >
      {children}
    </Link>
  );
}

function Destacado({ articulo }: { articulo: ArticuloListado }) {
  return (
    <Link
      href={`/blog/${articulo.slug}`}
      prefetch={false}
      className="grid overflow-hidden rounded-xl border bg-white transition-shadow hover:shadow-md md:grid-cols-2"
    >
      {articulo.imagenUrl && (
        <div className="relative aspect-[16/10] bg-muted md:aspect-auto md:h-full">
          <Image
            src={articulo.imagenUrl}
            alt=""
            fill
            sizes="(max-width: 768px) 100vw, 50vw"
            className="object-cover"
            priority
          />
        </div>
      )}

      <div className="flex flex-col justify-center p-6 md:p-8">
        <Meta articulo={articulo} />
        <h2 className="mt-2 text-2xl font-bold leading-tight">
          {articulo.titulo}
        </h2>
        <p className="mt-2 text-muted-foreground">{articulo.resumen}</p>
        <span className="mt-4 font-medium text-brand-orange-dark">
          Leer la nota →
        </span>
      </div>
    </Link>
  );
}

function Tarjeta({ articulo }: { articulo: ArticuloListado }) {
  return (
    <Link
      href={`/blog/${articulo.slug}`}
      prefetch={false}
      className="flex h-full flex-col overflow-hidden rounded-xl border bg-white transition-shadow hover:shadow-md"
    >
      {articulo.imagenUrl && (
        <div className="relative aspect-[16/9] bg-muted">
          <Image
            src={articulo.imagenUrl}
            alt=""
            fill
            sizes="(max-width: 768px) 100vw, 33vw"
            className="object-cover"
          />
        </div>
      )}

      <div className="flex flex-1 flex-col p-5">
        <Meta articulo={articulo} />
        <h2 className="mt-2 font-semibold leading-snug">{articulo.titulo}</h2>
        <p className="mt-1 flex-1 text-sm text-muted-foreground">
          {articulo.resumen}
        </p>
      </div>
    </Link>
  );
}

function Meta({ articulo }: { articulo: ArticuloListado }) {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      {articulo.categoria && (
        <span className="rounded-full bg-brand-orange/10 px-2.5 py-0.5 font-medium text-brand-orange-dark">
          {articulo.categoria}
        </span>
      )}
      {articulo.publicadoAt && (
        <span>{fechaLarga.format(articulo.publicadoAt)}</span>
      )}
      <span className="flex items-center gap-1.5">
        <Clock className="h-3.5 w-3.5" />
        {articulo.minutosLectura} min
      </span>
    </p>
  );
}
