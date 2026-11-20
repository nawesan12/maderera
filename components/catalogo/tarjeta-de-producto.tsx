"use client";

import Image from "next/image";
import Link from "next/link";
import { Loader2, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { useCarrito } from "@/lib/carrito-context";
import { formatearUnidad } from "@/lib/formato";
import type { ProductoListado } from "@/lib/dal/catalog";
import { PlacaDeProducto } from "@/components/catalogo/placa-de-producto";
import { BotonWhatsapp } from "@/components/whatsapp/boton";
import { enlaceDeConsulta } from "@/lib/catalogo/consulta";

/**
 * Tarjeta de producto del catálogo.
 *
 * Lo que decide una compra está arriba y grande: la foto y el precio —o, sin
 * precio, la medida—. El resto —categoría, unidad— acompaña en tamaño chico.
 * Cuando todo pesa lo mismo, hay que leer la tarjeta entera para saber si
 * sirve.
 *
 * **Sin foto propia va la placa del rubro** (hallazgo 25, 18/11/2026), y la
 * línea chica del rubro de arriba del nombre se saca: la placa ya lo dice.
 *
 * **La tarjeta ya no muestra stock.** Salieron la franja "Sin stock" y el
 * detalle por sucursal: al cliente no le importa en qué depósito está la
 * madera, y publicar existencias por sucursal invitaba a preguntas que se
 * resuelven recién en el carrito. Dónde hay lo dice la ficha
 * (`DisponibilidadPorSucursal`).
 *
 * `height: 100%` no es decorativo: iguala las alturas dentro de la grilla para
 * que la fila de botones quede alineada entre tarjetas vecinas.
 *
 * **Lo que depende de quién mira llega aparte**, en `etiqueta` y `precio`: los
 * arma `ProductCard`, del lado del servidor, detrás de su `<Suspense>`. Esta
 * parte es la que necesita el navegador —el botón de agregar— y es igual para
 * todo el mundo.
 *
 * **Los enlaces a la ficha vuelven a precargarse.** Tuvieron `prefetch={false}`
 * mientras el sitio vivió en Vercel, donde cada precarga era una función
 * facturada y una vuelta a la base. La ficha ya sale armada de antemano —el
 * precio de quien mira llega aparte— y en el servidor propio el costo es fijo:
 * precargar lo que está a la vista vuelve a hacer instantánea la navegación al
 * detalle.
 */
export function TarjetaDeProducto({
  product,
  whatsapp,
  etiqueta,
  precio,
  filtro,
}: {
  product: ProductoListado;
  /** La categoría (y el rubro) por los que está filtrada la grilla, si hay. */
  filtro?: { cat?: string; rubro?: string };
  /** Número del negocio, en dígitos. Baja del servidor porque el dato es
   *  editable desde el panel y esto es un componente de cliente. */
  whatsapp: string;
  /** El descuento, sobre la foto. Depende de la lista de quien mira. */
  etiqueta: ReactNode;
  /** El bloque de precio. Depende de la lista y de la vista de IVA de quien mira. */
  precio: ReactNode;
}) {
  const { agregar, guardando } = useCarrito();

  /*
   * Si se puede agregar directo o hay que ir a la ficha se decide con el
   * precio de público: es lo que se sabe al armar la página. Un producto sin
   * precio general y con precio en la lista de un profesional es raro, y si
   * se da, el botón lo lleva a la ficha —donde ve su precio y elige—, que es
   * el camino seguro.
   */
  const sinPrecio = !product.precioDesde || Number(product.precioDesde) <= 0;
  const variasMedidas = product.labels.length > 1;

  const rubro = product.subcategory || product.categoryName;
  /*
   * La línea del rubro va en todas las tarjetas, desde `sm`: con la línea
   * solo en las que tienen foto, el nombre y el precio quedaban a distinta
   * altura en la misma fila (revisión del 19/11). Se lee solo con foto —sin
   * foto la placa ya lo dice— y cuando no repite el filtro de la grilla
   * («PLACAS» dentro de Placas). Si no, queda el renglón vacío.
   */
  const rubroRedundante =
    filtro?.cat === product.categorySlug &&
    (!product.subcategory || (!!filtro.rubro && filtro.rubro === product.subcategorySlug));
  const rubroVisible = Boolean(product.image) && !rubroRedundante;
  // Con una sola medida, el mensaje ya la lleva: quien atiende contesta sin
  // preguntar cuál. Con varias, la elige en la ficha.
  const consulta = enlaceDeConsulta(
    whatsapp,
    product.labels.length === 1
      ? `Hola! Quería el precio de ${product.name} — ${product.labels[0]}.`
      : `Hola! Quería consultar por ${product.name}.`,
  );
  /*
   * Sin precio, la acción de la tarjeta es preguntarlo, con nombre y a la
   * vista (lo pidió el dueño en el comité: la medida sola no dice si se puede
   * comprar). Con precio queda el ícono al lado de «Agregar».
   */
  const consultarPrecio = sinPrecio;

  return (
    /*
     * En el teléfono la foto manda (Nahuel, 18/11: «tienen que ocupar lo
     * máximo posible la foto del producto, si al fin y al cabo es lo que está
     * comprando»): de borde a borde de la pantalla, cuadrada, sin esquinas
     * redondeadas ni nada encima, y abajo solo el nombre, el precio y el
     * WhatsApp. Desde `sm` vuelve a ser la tarjeta de la grilla.
     */
    <article className="group relative flex h-full flex-col overflow-hidden bg-card max-sm:ml-[calc(50%-50vw)] max-sm:w-screen sm:rounded-[14px] sm:superficie sm:shadow-[0_1px_2px_rgb(60_50_40_/_0.05)] sm:transition-[box-shadow,transform,border-color] sm:duration-200 sm:hover:-translate-y-[3px] sm:hover:border-linea-hover sm:hover:shadow-[0_14px_30px_-16px_rgb(60_50_40_/_0.34)] motion-reduce:transform-none motion-reduce:transition-none">
      {/* La foto lleva a la misma ficha que el nombre de abajo: fuera del Tab
          y de los lectores, que si no la anunciaban dos veces (y sin foto,
          como un enlace sin nombre). */}
      {/* Sin foto la placa es baja en el celular: el cuadrado de borde a
          borde se justificaba con una foto, y veintinueve placas cuadradas
          seguidas son un catálogo marrón. Desde `sm`, 4/3 como la foto, para
          que la grilla quede pareja. */}
      <Link
        href={`/catalogo/${product.slug}`}
        tabIndex={-1}
        aria-hidden="true"
        className={`relative block overflow-hidden bg-brand-wood-light/25 sm:aspect-[4/3] ${
          product.image ? "aspect-square" : "aspect-[5/2]"
        }`}
      >
        {/* El acercamiento crece desde abajo: en las placas el canto va
            abajo de la foto y es lo que muestra qué es. */}
        {product.image ? (
          <Image
            src={product.image}
            alt={product.name}
            fill
            className="origin-bottom object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transform-none"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          />
        ) : (
          <PlacaDeProducto rubro={rubro} categoria={product.categorySlug} marca={product.brand} />
        )}

        {/* El cartel tapaba la foto en el teléfono; el descuento igual se ve en el precio. */}
        <span className="hidden sm:contents">{etiqueta}</span>
      </Link>

      <div
        className={`flex flex-1 flex-col gap-2 px-4 pb-4 pt-3 sm:gap-[13px] sm:pt-[15px] ${
          // Lugar para el WhatsApp, que en el teléfono va a la altura del precio.
          variasMedidas && !consultarPrecio ? "max-sm:pr-16" : ""
        }`}
      >
        <div className="flex flex-col gap-[3px]">
          <p
            className={`text-[10.5px] font-bold uppercase tracking-[0.11em] text-acento-texto ${
              rubroVisible ? "" : "invisible max-sm:hidden"
            }`}
            aria-hidden={rubroVisible ? undefined : true}
          >
            {rubro}
          </p>
          <Link
            href={`/catalogo/${product.slug}`}
            className="line-clamp-2 text-[15.5px] font-semibold leading-[1.32] tracking-[-0.01em] transition-colors hover:text-acento-texto"
          >
            {product.name}
          </Link>
        </div>

        {precio}

        {/* Las medidas que faltan ya las cuenta el «+N» del precio. */}
        <div className="hidden flex-wrap gap-[5px] sm:flex">
          <span className="inline-flex h-[23px] items-center rounded-md bg-chip px-2 text-[11.5px] text-texto-2">
            por {formatearUnidad(product.unit)}
          </span>
        </div>

        {consultarPrecio ? (
          <div className="mt-auto flex sm:border-t sm:border-linea-tenue sm:pt-3.5">
            <BotonWhatsapp
              enlace={consulta}
              className="min-w-0 flex-1"
              aria-label={`Consultar el precio de ${product.name} por WhatsApp`}
            >
              Consultar precio
            </BotonWhatsapp>
          </div>
        ) : (
          /* Sin «Agregar», en el teléfono el WhatsApp sube a la altura del
             precio: solo, ocupaba un renglón entero. El espacio entre los dos
             es a propósito: pegados, con el pulgar se toca el que no era. */
          <div
            className={`mt-auto flex justify-end gap-3 sm:border-t sm:border-linea-tenue sm:pt-3.5 ${
              variasMedidas ? "max-sm:absolute max-sm:bottom-4 max-sm:right-4" : ""
            }`}
          >
            {variasMedidas ? (
              <Link
                href={`/catalogo/${product.slug}`}
                className={buttonVariants({
                  variant: "outline",
                  className:
                    "h-11 min-w-0 flex-1 rounded-[10px] border-linea text-[14.5px] font-semibold max-sm:!hidden",
                })}
              >
                Elegir medida
              </Link>
            ) : (
              <Button
                disabled={guardando}
                className="h-11 min-w-0 flex-1 rounded-[10px] bg-accion text-[14.5px] font-semibold text-white hover:bg-accion-hover"
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

            <BotonWhatsapp
              enlace={consulta}
              variante="secundario"
              tamano="icono"
              aria-label={`Consultar por ${product.name} por WhatsApp`}
            />
          </div>
        )}
      </div>
    </article>
  );
}
