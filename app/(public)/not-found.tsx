import Link from "next/link";
import { Compass, MessageCircle, Search } from "lucide-react";
import { EncabezadoPublico } from "@/components/encabezado-publico";

/**
 * Página no encontrada, dentro del sitio.
 *
 * Cae acá lo que `notFound()` levanta desde una ruta pública: un producto que
 * se dio de baja, una nota borrada, un pedido con número inventado. Hereda el
 * layout, así que mantiene el menú y el pie: una 404 sin navegación es un
 * callejón, y quien llegó desde Google se va.
 *
 * Los tres caminos que se ofrecen son los que resuelven el 404 real: el
 * producto cambió de nombre (buscador), la página se movió (catálogo), o hace
 * falta preguntar (WhatsApp).
 */
export default function NoEncontrado() {
  return (
    <>
      <EncabezadoPublico
        titulo="No encontramos esa página"
        bajada="Puede que el producto ya no esté publicado o que la dirección haya cambiado."
      />

      <div className="contenedor py-14">
        <div className="mx-auto grid max-w-3xl gap-3 sm:grid-cols-3">
          <Link
            href="/catalogo"
            className="rounded-[14px] border border-linea bg-card p-5 transition-colors hover:border-linea-hover"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-naranja-claro text-acento-sobre-claro">
              <Search className="h-5 w-5" />
            </span>
            <p className="mt-3.5 font-semibold">Buscar en el catálogo</p>
            <p className="mt-1 text-sm text-texto-2">
              Por nombre, medida o código.
            </p>
          </Link>

          <Link
            href="/"
            className="rounded-[14px] border border-linea bg-card p-5 transition-colors hover:border-linea-hover"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-naranja-claro text-acento-sobre-claro">
              <Compass className="h-5 w-5" />
            </span>
            <p className="mt-3.5 font-semibold">Volver al inicio</p>
            <p className="mt-1 text-sm text-texto-2">
              Todo el sitio desde el principio.
            </p>
          </Link>

          <a
            href="https://wa.me/542235903118"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-[14px] border border-linea bg-card p-5 transition-colors hover:border-linea-hover"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-verde-whatsapp/15 text-verde-whatsapp">
              <MessageCircle className="h-5 w-5" />
            </span>
            <p className="mt-3.5 font-semibold">Preguntarnos</p>
            <p className="mt-1 text-sm text-texto-2">
              Si sabés qué buscabas, te lo encontramos.
            </p>
          </a>
        </div>
      </div>
    </>
  );
}
