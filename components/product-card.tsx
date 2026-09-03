"use client";

import Image from "next/image";
import Link from "next/link";
import { ImageOff, Loader2, MessageCircle, Plus } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { useCarrito } from "@/lib/carrito-context";
import { formatearPrecio, formatearUnidad } from "@/lib/formato";
import { PrecioSinImpuestos } from "@/components/precio-sin-impuestos";
import type { ProductoListado } from "@/lib/dal/catalog";

/**
 * Tarjeta de producto del catálogo.
 *
 * Lo que decide una compra está arriba y grande: la foto y el precio. El resto
 * —categoría, unidad, medidas— acompaña en tamaño chico. Cuando todo pesa lo
 * mismo, hay que leer la tarjeta entera para saber si sirve.
 *
 * **La tarjeta ya no muestra stock.** Salieron la franja "Sin stock" y el
 * detalle por sucursal: al cliente no le importa en qué depósito está la
 * madera, y publicar existencias por sucursal invitaba a preguntas que se
 * resuelven recién en el checkout. `Disponibilidad` sigue en uso en la ficha
 * del producto y en el panel.
 *
 * `height: 100%` no es decorativo: iguala las alturas dentro de la grilla para
 * que la fila de botones quede alineada entre tarjetas vecinas.
 *
 * **Los enlaces al producto van con `prefetch={false}` a propósito.** La ficha
 * del producto es una ruta dinámica —el precio depende de la lista de quien
 * mira, ver `precios-sesion.ts`—, así que no se sirve del CDN: cada prefetch es
 * una ejecución en el servidor y una vuelta a la base. Con veinticuatro
 * tarjetas por página, scrollear el catálogo disparaba veinticuatro renders de
 * páginas que nadie pidió. Se paga a cambio que la navegación al detalle deje
 * de ser instantánea.
 */
export function ProductCard({
  product,
  whatsapp,
}: {
  product: ProductoListado;
  /** Número del negocio, en dígitos. Baja del servidor porque el dato es
   *  editable desde el panel y esto es un componente de cliente. */
  whatsapp: string;
}) {
  const { agregar, guardando } = useCarrito();

  const sinPrecio = !product.precioDesde || Number(product.precioDesde) <= 0;
  const variasMedidas = product.labels.length > 1;
  const enOferta = product.descuento !== null;

  const consulta = `https://wa.me/${whatsapp}?text=${encodeURIComponent(
    `Hola! Quería consultar por ${product.name}.`,
  )}`;

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-[14px] border border-linea bg-card shadow-[0_1px_2px_rgb(60_50_40_/_0.05)] transition-[box-shadow,transform,border-color] duration-200 hover:-translate-y-[3px] hover:border-linea-hover hover:shadow-[0_14px_30px_-16px_rgb(60_50_40_/_0.34)] motion-reduce:transform-none motion-reduce:transition-none">
      <Link
        href={`/catalogo/${product.slug}`}
        prefetch={false}
        className="relative block aspect-[4/3] overflow-hidden bg-brand-wood-light/25"
      >
        {product.image ? (
          <Image
            src={product.image}
            alt={product.name}
            fill
            className="object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transform-none"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          />
        ) : (
          <span className="flex h-full items-center justify-center text-texto-3">
            <ImageOff className="h-8 w-8" />
          </span>
        )}

        {/* El descuento manda sobre "Destacado": si el producto está en oferta,
            eso es lo que hay que ver. */}
        {enOferta ? (
          <span className="absolute left-3 top-3 rounded-full bg-rojo-oferta px-[11px] py-[5px] text-[12.5px] font-bold text-white shadow-[0_2px_8px_-2px_rgb(120_25_10_/_0.5)]">
            −{product.descuento}%
          </span>
        ) : (
          product.featured && (
            <span className="absolute left-3 top-3 rounded-full bg-accion px-[11px] py-[5px] text-[10.5px] font-bold uppercase tracking-[0.1em] text-white shadow-sm">
              Destacado
            </span>
          )
        )}
      </Link>

      <div className="flex flex-1 flex-col gap-[13px] px-4 pb-4 pt-[15px]">
        <div className="flex flex-col gap-[3px]">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.11em] text-acento-texto">
            {product.subcategory || product.categoryName}
          </p>
          <Link
            href={`/catalogo/${product.slug}`}
            prefetch={false}
            className="line-clamp-2 text-[15.5px] font-semibold leading-[1.32] tracking-[-0.01em] transition-colors hover:text-acento-texto"
          >
            {product.name}
          </Link>
        </div>

        {/* Precio: lo primero que se mira después de la foto. Va en una sola
            línea —"desde", importe y precio tachado— para que no se parta en
            dos renglones y deje de leerse como un solo dato. */}
        <div className="flex flex-col gap-1">
          {sinPrecio ? (
            <>
              <p className="text-[19px] font-bold tracking-[-0.02em] text-foreground">
                A consultar
              </p>
              <p className="text-xs text-texto-3">Te pasamos el precio por WhatsApp</p>
            </>
          ) : (
            <>
              <p className="flex items-baseline gap-[7px] whitespace-nowrap">
                {variasMedidas && (
                  <span className="text-xs leading-none text-texto-3">desde</span>
                )}
                <span
                  className={`tabular text-[21px] font-bold leading-none tracking-[-0.03em] ${
                    enOferta ? "text-rojo-oferta" : "text-foreground"
                  }`}
                >
                  {formatearPrecio(product.precioDesde)}
                </span>
                {product.precioAnterior && (
                  <span className="tabular text-[12.5px] leading-none text-texto-3 line-through">
                    {formatearPrecio(product.precioAnterior)}
                  </span>
                )}
              </p>
              {/* Ley 27.743: junto al precio final se informa el neto. */}
              <PrecioSinImpuestos
                precioFinal={Number(product.precioDesde)}
                compacto
              />
            </>
          )}
        </div>

        <div className="flex flex-wrap gap-[5px]">
          <span className="inline-flex h-[23px] items-center rounded-md bg-chip px-2 text-[11.5px] text-texto-2">
            por {formatearUnidad(product.unit)}
          </span>
          {variasMedidas && (
            <span className="tabular inline-flex h-[23px] items-center rounded-md bg-chip px-2 text-[11.5px] text-texto-2">
              {product.labels.length} medidas
            </span>
          )}
        </div>

        <div className="mt-auto flex gap-2 border-t border-linea-tenue pt-3.5">
          {variasMedidas || sinPrecio ? (
            <Link
              href={`/catalogo/${product.slug}`}
              prefetch={false}
              className={buttonVariants({
                variant: "outline",
                className:
                  "h-[42px] min-w-0 flex-1 rounded-[9px] border-linea text-[14.5px] font-semibold",
              })}
            >
              {sinPrecio ? "Pedir cotización" : "Elegir medida"}
            </Link>
          ) : (
            <Button
              disabled={guardando}
              className="h-[42px] min-w-0 flex-1 rounded-[9px] bg-accion text-[14.5px] font-semibold text-white hover:bg-accion-hover"
              onClick={() =>
                agregar({
                  descripcion: product.name,
                  unidad: product.unit,
                  cantidad: 1,
                  origen: "catalogo",
                })
              }
            >
              {guardando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Agregar
            </Button>
          )}

          <a
            href={consulta}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Consultar por ${product.name} por WhatsApp`}
            className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[9px] border border-linea text-verde-whatsapp transition-colors hover:border-verde-whatsapp/40 hover:bg-verde-whatsapp/10"
          >
            <MessageCircle className="h-[18px] w-[18px]" />
          </a>
        </div>
      </div>
    </article>
  );
}
