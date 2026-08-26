import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, MessageSquareQuote, Settings2, Star } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { fechaCorta } from "@/lib/formato";
import {
  listarAjustes,
  listarArticulosAdmin,
  listarCategoriasAdmin,
  listarTestimoniosAdmin,
} from "@/lib/dal/admin/contenido";
import { EditorDeNota } from "./editor";
import {
  AccionesNota,
  Ajustes,
  NuevaCategoria,
  Testimonios,
} from "./secciones";

export const metadata: Metadata = { title: "Contenido" };

/**
 * Contenido del sitio: blog, testimonios y ajustes.
 *
 * Estaba todo escrito como constantes de TypeScript, lo que significaba que
 * publicar una nota o sacar un testimonio costaba un deploy. Acá se edita, y el
 * sitio lo refleja apenas se guarda.
 */
export default async function ContenidoPage() {
  const [articulos, categorias, testimonios, ajustes] = await Promise.all([
    listarArticulosAdmin(),
    listarCategoriasAdmin(),
    listarTestimoniosAdmin(),
    listarAjustes(),
  ]);

  const publicadas = articulos.filter((a) => a.estado === "publicado");
  const borradores = articulos.filter((a) => a.estado !== "publicado");

  return (
    <div className="space-y-6">
      <EncabezadoPanel
        titulo="Contenido"
        detalle="El blog, los testimonios y los textos que se pueden cambiar sin tocar el código."
      >
        <Link
          href="/blog"
          target="_blank"
          className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted"
        >
          <BookOpen className="h-5 w-5" />
          Ver el blog
        </Link>
      </EncabezadoPanel>

      <EditorDeNota categorias={categorias} />

      {borradores.length > 0 && (
        <Grupo titulo="Borradores" detalle="Todavía no se ven en el sitio">
          {borradores.map((articulo) => (
            <FilaNota
              key={articulo.id}
              articulo={articulo}
              categorias={categorias}
            />
          ))}
        </Grupo>
      )}

      <Grupo
        titulo="Publicadas"
        detalle={`${publicadas.length} en el blog`}
      >
        {publicadas.length === 0 ? (
          <li className="px-5 py-10 text-center text-base text-muted-foreground">
            Todavía no hay ninguna nota publicada.
          </li>
        ) : (
          publicadas.map((articulo) => (
            <FilaNota
              key={articulo.id}
              articulo={articulo}
              categorias={categorias}
            />
          ))
        )}
      </Grupo>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="tarjeta p-5">
          <h2 className="text-base font-medium">Categorías del blog</h2>
          <p className="mt-0.5 text-base text-muted-foreground">
            Las que no tienen notas publicadas no se muestran en el sitio.
          </p>

          <ul className="mt-3 flex flex-wrap gap-2">
            {categorias.map((c) => (
              <li
                key={c.id}
                className="rounded-full border px-3 py-1 text-base"
              >
                {c.nombre}
                <span className="tabular ml-1.5 text-muted-foreground">
                  {c.notas}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-4">
            <NuevaCategoria />
          </div>
        </section>

        <section className="tarjeta p-5">
          <h2 className="flex items-center gap-2 text-base font-medium">
            <MessageSquareQuote className="h-5 w-5 text-muted-foreground" />
            Testimonios
          </h2>
          <p className="mt-0.5 text-base text-muted-foreground">
            Se muestran en la portada. Son personas reales: si alguien pide que
            saquen el suyo, se apaga desde acá.
          </p>

          <div className="mt-3">
            <Testimonios testimonios={testimonios} />
          </div>
        </section>
      </div>

      <section className="tarjeta p-5">
        <h2 className="flex items-center gap-2 text-base font-medium">
          <Settings2 className="h-5 w-5 text-muted-foreground" />
          Textos del sitio
        </h2>
        <p className="mt-0.5 text-base text-muted-foreground">
          Cosas que cambian cada tanto y no deberían necesitar un programador.
        </p>

        <div className="mt-4">
          <Ajustes ajustes={ajustes} />
        </div>
      </section>
    </div>
  );
}

function Grupo({
  titulo,
  detalle,
  children,
}: {
  titulo: string;
  detalle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="tarjeta">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-4">
        <h2 className="text-base font-medium">{titulo}</h2>
        <p className="text-base text-muted-foreground">{detalle}</p>
      </div>
      <ul className="divide-y">{children}</ul>
    </section>
  );
}

function FilaNota({
  articulo,
  categorias,
}: {
  articulo: Awaited<ReturnType<typeof listarArticulosAdmin>>[number];
  categorias: { id: string; nombre: string }[];
}) {
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-[16rem] flex-1">
          <p className="flex flex-wrap items-center gap-2 text-base font-medium">
            {articulo.destacado && (
              <Star className="h-4 w-4 fill-brand-orange text-brand-orange" />
            )}
            {articulo.titulo}
            <EtiquetaEstado estado={articulo.estado} />
          </p>
          <p className="text-base text-muted-foreground">
            {articulo.categoria ?? "Sin categoría"} ·{" "}
            {articulo.minutosLectura} min ·{" "}
            {articulo.publicadoAt
              ? `publicada el ${fechaCorta.format(articulo.publicadoAt)}`
              : "sin publicar"}
          </p>
          <p className="mt-0.5 line-clamp-1 text-base text-muted-foreground">
            {articulo.resumen}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {articulo.estado === "publicado" && (
            <Link
              href={`/blog/${articulo.slug}`}
              target="_blank"
              className="inline-flex h-9 items-center rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
            >
              Ver
            </Link>
          )}
          <EditorDeNota articulo={articulo} categorias={categorias} />
          <AccionesNota id={articulo.id} estado={articulo.estado} />
        </div>
      </div>
    </li>
  );
}
