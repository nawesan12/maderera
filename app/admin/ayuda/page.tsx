import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, LifeBuoy, Search } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { buscarEnGuias, listarGuias } from "@/lib/guias";
import { requireStaff } from "@/lib/dal/session";

export const metadata: Metadata = { title: "Ayuda" };

/**
 * Las guías de uso del panel (cláusula 1.10).
 *
 * Están adentro del sistema y no en un PDF aparte porque el momento en que
 * hacen falta es mientras se está usando una pantalla, no antes. Un manual que
 * hay que ir a buscar no se lee.
 *
 * La búsqueda entra por la URL para que un enlace a un resultado se pueda pasar
 * por WhatsApp tal cual: "mirá acá cómo se hace".
 */
export default async function AyudaPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireStaff();

  const { q } = await searchParams;
  const termino = q?.trim() ?? "";

  const [guias, resultados] = await Promise.all([
    listarGuias(),
    termino ? buscarEnGuias(termino) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <EncabezadoPanel
        titulo="Ayuda"
        detalle="Cómo se hace cada cosa en el panel, explicado paso a paso."
      />

      <form method="get" className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <label htmlFor="q" className="sr-only">
            Buscar en las guías
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={termino}
            placeholder="Buscar: cuenta corriente, anular una factura, transferir stock…"
            className="h-11 w-full rounded-lg border bg-background pl-10 pr-3 text-base"
          />
        </div>
        <button
          type="submit"
          className="h-11 rounded-lg border px-4 text-base font-medium transition-colors hover:bg-muted"
        >
          Buscar
        </button>
      </form>

      {termino && (
        <section>
          <h2 className="text-base font-semibold">
            {resultados.length === 0
              ? `Nada sobre «${termino}»`
              : `${resultados.length} ${resultados.length === 1 ? "guía habla" : "guías hablan"} de «${termino}»`}
          </h2>

          {resultados.length === 0 ? (
            <p className="mt-2 text-base text-muted-foreground">
              Probá con una palabra sola, o mirá el listado de abajo.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {resultados.map(({ guia, contexto }) => (
                <li key={guia.slug}>
                  <Link
                    href={`/admin/ayuda/${guia.slug}`}
                    className="tarjeta tarjeta-activa block p-4"
                  >
                    <p className="text-base font-medium">{guia.titulo}</p>
                    <p className="mt-1 text-base text-muted-foreground">
                      {contexto}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section>
        {termino && (
          <h2 className="mb-3 text-base font-semibold text-muted-foreground">
            Todas las guías
          </h2>
        )}

        {guias.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-12 text-center text-base text-muted-foreground">
            <BookOpen className="mx-auto mb-2 h-6 w-6" />
            Todavía no hay guías cargadas.
          </p>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {guias.map((guia) => (
              <li key={guia.slug}>
                <Link
                  href={`/admin/ayuda/${guia.slug}`}
                  className="tarjeta tarjeta-activa flex h-full flex-col gap-2 p-5"
                >
                  <h3 className="text-lg font-semibold">{guia.titulo}</h3>
                  <p className="text-base text-muted-foreground">
                    {guia.resumen}
                  </p>
                  {guia.secciones.length > 0 && (
                    <p className="mt-auto pt-2 text-sm text-muted-foreground">
                      {guia.secciones.slice(0, 3).join(" · ")}
                      {guia.secciones.length > 3 && " …"}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="flex items-start gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-base text-muted-foreground">
        <LifeBuoy className="mt-0.5 h-5 w-5 shrink-0" />
        <span>
          Si algo no está acá o quedó desactualizado, avisá: las guías se
          corrigen junto con las pantallas que describen.
        </span>
      </p>
    </div>
  );
}
