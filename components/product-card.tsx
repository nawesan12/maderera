"use client";

import Image from "next/image";
import Link from "next/link";
import { ImageOff, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Disponibilidad } from "@/components/catalogo/disponibilidad";
import { useCarrito } from "@/lib/carrito-context";
import { formatearPrecio, formatearUnidad } from "@/lib/formato";
import { PrecioSinImpuestos } from "@/components/precio-sin-impuestos";
import type { ProductoListado } from "@/lib/dal/catalog";

/**
 * Tarjeta de producto del catálogo.
 *
 * Lo que decide una compra está arriba y grande: la foto, el precio y si hay
 * stock. El resto —categoría, medidas— acompaña en tamaño chico. Cuando todo
 * pesa lo mismo, hay que leer la tarjeta entera para saber si sirve.
 */
export function ProductCard({ product }: { product: ProductoListado }) {
  const { agregar, guardando } = useCarrito();

  const sinPrecio = !product.precioDesde || Number(product.precioDesde) <= 0;
  const variasMedidas = product.labels.length > 1;

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg">
      <Link
        href={`/catalogo/${product.slug}`}
        className="relative block aspect-[4/3] overflow-hidden bg-brand-wood-light/25"
      >
        {product.image ? (
          <Image
            src={product.image}
            alt={product.name}
            fill
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          />
        ) : (
          <span className="flex h-full items-center justify-center text-muted-foreground">
            <ImageOff className="h-8 w-8" />
          </span>
        )}

        {/* El descuento manda sobre el resto de las etiquetas. */}
        {product.descuento !== null ? (
          <span className="absolute left-3 top-3 rounded-full bg-brand-red px-2.5 py-1 text-xs font-bold text-white shadow-sm">
            −{product.descuento}%
          </span>
        ) : (
          product.featured && (
            <span className="absolute left-3 top-3 rounded-full bg-brand-orange px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-sm">
              Destacado
            </span>
          )
        )}

        {!product.hayStock && (
          <span className="absolute inset-x-0 bottom-0 bg-brand-gray/85 py-1.5 text-center text-xs font-medium text-white">
            Sin stock — consultanos
          </span>
        )}
      </Link>

      <div className="flex flex-1 flex-col p-4">
        <p className="text-[10px] font-bold uppercase tracking-wider text-brand-orange">
          {product.subcategory || product.categoryName}
        </p>

        <Link
          href={`/catalogo/${product.slug}`}
          className="mt-0.5 line-clamp-2 text-sm font-semibold leading-snug transition-colors hover:text-brand-orange"
        >
          {product.name}
        </Link>

        {/* Precio: lo primero que se mira después de la foto. */}
        <div className="mt-2.5">
          {sinPrecio ? (
            <p className="text-lg font-bold text-brand-gray">A consultar</p>
          ) : (
            <>
              {product.precioAnterior && (
                <p className="tabular text-xs text-muted-foreground line-through">
                  {formatearPrecio(product.precioAnterior)}
                </p>
              )}
              <p className="flex items-baseline gap-1.5">
                <span
                  className={`tabular text-xl font-bold ${
                    product.descuento !== null
                      ? "text-brand-red"
                      : "text-brand-gray"
                  }`}
                >
                  {formatearPrecio(product.precioDesde)}
                </span>
                {variasMedidas && (
                  <span className="text-[11px] text-muted-foreground">desde</span>
                )}
              </p>
              <p className="text-[11px] text-muted-foreground">
                por {formatearUnidad(product.unit)}
                {variasMedidas && ` · ${product.labels.length} medidas`}
              </p>
              {/* Ley 27.743: junto al precio final se informa el neto. */}
              <PrecioSinImpuestos
                precioFinal={Number(product.precioDesde)}
                className="mt-0.5"
              />
            </>
          )}
        </div>

        <div className="mt-2">
          <Disponibilidad
            central={product.stockCentral}
            aserradero={product.stockAserradero}
            compacto
          />
        </div>

        <div className="mt-3 pt-1">
          {variasMedidas || sinPrecio ? (
            <Link href={`/catalogo/${product.slug}`} className="block">
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs font-medium transition-colors hover:border-brand-orange hover:bg-brand-orange hover:text-white"
              >
                {sinPrecio ? "Pedir cotización" : "Elegir medida"}
              </Button>
            </Link>
          ) : (
            <Button
              size="sm"
              disabled={guardando}
              className="w-full bg-brand-orange text-xs font-medium text-white hover:bg-brand-orange-dark"
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
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Agregar
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
