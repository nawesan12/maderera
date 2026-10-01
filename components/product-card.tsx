import { Suspense } from "react";
import { TarjetaDeProducto } from "@/components/catalogo/tarjeta-de-producto";
import { EtiquetaDeTarjeta, PrecioDeTarjeta } from "@/components/catalogo/precio-de-tarjeta";
import { precioDeTarjeta } from "@/lib/dal/visitante";
import type { ProductoListado } from "@/lib/dal/catalog";
import type { VistaDePrecio } from "@/lib/precios/vista";

/**
 * Tarjeta de producto, con el precio de quien mira.
 *
 * **Por qué se arma en el servidor.** Un profesional con lista propia veía
 * primero el precio de público y después el suyo: la página salía armada para
 * todos y el navegador la corregía con `/api/mis-precios`, que además bajaba
 * el mapa de precios del catálogo entero.
 *
 * Ahora la tarjeta sigue saliendo armada, con el precio de público, y el
 * precio y el descuento van detrás de un `<Suspense>` que el servidor completa
 * en la misma respuesta. Para el público el resultado es idéntico al
 * respaldo; para el profesional llega su precio antes de que la página
 * termine de cargar. Y en el HTML queda solo el precio de lo que se ve.
 *
 * `vista` es la que se sabe al armar la página: «final» en las páginas
 * públicas, la de la persona en las que ya leen la sesión, como `/carrito`.
 */
export function ProductCard({
  product,
  whatsapp,
  vista = "final",
}: {
  product: ProductoListado;
  whatsapp: string;
  vista?: VistaDePrecio;
}) {
  return (
    <TarjetaDeProducto
      product={product}
      whatsapp={whatsapp}
      etiqueta={
        <Suspense fallback={<EtiquetaDeTarjeta product={product} propio={null} />}>
          <EtiquetaDeQuienMira product={product} />
        </Suspense>
      }
      precio={
        <Suspense fallback={<PrecioDeTarjeta product={product} propio={null} vista={vista} />}>
          <PrecioDeQuienMira product={product} />
        </Suspense>
      }
    />
  );
}

async function EtiquetaDeQuienMira({ product }: { product: ProductoListado }) {
  const { propio } = await precioDeTarjeta(product.slug);
  return <EtiquetaDeTarjeta product={product} propio={propio} />;
}

async function PrecioDeQuienMira({ product }: { product: ProductoListado }) {
  const { propio, vista } = await precioDeTarjeta(product.slug);
  return <PrecioDeTarjeta product={product} propio={propio} vista={vista} />;
}
