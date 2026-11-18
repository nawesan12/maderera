import Link from "next/link";
import { formatearPrecio } from "@/lib/formato";
import { medidaPrincipal } from "@/lib/catalogo/medida";
import { PrecioSecundario } from "@/components/precio";
import { presentarComparado, presentarPrecio, type VistaDePrecio } from "@/lib/precios/vista";
import type { ProductoListado } from "@/lib/dal/catalog";
import type { PrecioPropio } from "@/lib/dal/visitante";

/*
 * Lo que en una tarjeta depende de quién mira: el precio y el descuento.
 *
 * Son componentes sin estado ni efectos, para poder dibujarse dos veces: una
 * con el precio de público, que queda en la página armada de antemano, y otra
 * con el de quien mira, que llega en la misma respuesta por streaming. Ver
 * `ProductCard`.
 */

/** El precio que vale: el propio si lo hay, si no el de público. */
function vigente(product: ProductoListado, propio: PrecioPropio | null) {
  return {
    precioDesde: propio?.desde ?? product.precioDesde,
    precioAnterior: propio ? propio.anterior : product.precioAnterior,
    descuento: propio ? propio.descuento : product.descuento,
  };
}

/**
 * El descuento, sobre la foto. «Destacado» salió (hallazgo 26, 18/11/2026):
 * lo llevaban 9 de 29 productos y, cuando un tercio está destacado, no
 * destaca nada. La marca sigue sirviendo para ordenar por relevancia.
 */
export function EtiquetaDeTarjeta({
  product,
  propio,
}: {
  product: ProductoListado;
  propio: PrecioPropio | null;
}) {
  const { descuento } = vigente(product, propio);
  if (descuento === null) return null;
  return (
    <span className="absolute left-3 top-3 rounded-full bg-rojo-oferta px-[11px] py-[5px] text-[12.5px] font-bold text-white shadow-[0_2px_8px_-2px_rgb(120_25_10_/_0.5)]">
      −{descuento}%
    </span>
  );
}

/**
 * Precio: lo primero que se mira después de la foto. Va en una sola línea
 * —«desde», importe y precio tachado— para que no se parta en dos renglones y
 * deje de leerse como un solo dato.
 */
export function PrecioDeTarjeta({
  product,
  propio,
  vista,
}: {
  product: ProductoListado;
  propio: PrecioPropio | null;
  vista: VistaDePrecio;
}) {
  const { precioDesde, precioAnterior, descuento } = vigente(product, propio);
  const alicuota = Number(product.alicuotaIva) || 21;
  const sinPrecio = !precioDesde || Number(precioDesde) <= 0;
  const variasMedidas = product.labels.length > 1;
  const enOferta = descuento !== null;

  if (sinPrecio) return <MedidaDeTarjeta product={product} />;

  const mostrado = presentarPrecio(Number(precioDesde), alicuota, vista);

  return (
    <div className="flex flex-col gap-1">
      <p className="flex items-baseline gap-[7px] whitespace-nowrap">
        {variasMedidas && <span className="text-xs leading-none text-texto-3">desde</span>}
        <span
          className={`tabular text-[21px] font-bold leading-none tracking-[-0.03em] ${
            enOferta ? "text-rojo-oferta" : "text-foreground"
          }`}
        >
          {formatearPrecio(String(mostrado.principal))}
        </span>
        {mostrado.sufijo && (
          <span className="text-[11.5px] font-semibold leading-none text-texto-3">
            {mostrado.sufijo}
          </span>
        )}
        {precioAnterior && (
          <span className="tabular text-[12.5px] leading-none text-texto-3 line-through">
            {formatearPrecio(
              String(presentarComparado(Number(precioAnterior), alicuota, vista)),
            )}
          </span>
        )}
      </p>
      <PrecioSecundario
        precioFinal={Number(precioDesde)}
        alicuota={alicuota}
        vista={vista}
        compacto
      />
    </div>
  );
}

/**
 * Sin precio, el lugar del precio es de la medida (hallazgo 26, 18/11/2026).
 *
 * «A consultar» era lo más grande de la tarjeta, 29 veces, y lo útil —la
 * medida— iba en una pastilla que en el celular ni se veía. La acción de
 * preguntar el precio la lleva el botón de WhatsApp de abajo.
 *
 * Cada parte de la medida va sin cortes por dentro y el renglón se puede
 * partir entre una y otra: «1220 × 2440 mm» arriba y «18 mm» abajo si no
 * entra, nunca «1220 × 2440» y «mm» sueltos. El «+N» lleva a la ficha, que es
 * donde están las otras.
 */
function MedidaDeTarjeta({ product }: { product: ProductoListado }) {
  const medida = medidaPrincipal(product.labels);
  if (!medida) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="tabular flex flex-wrap gap-x-1.5 text-[17px] font-semibold leading-tight tracking-[-0.01em] text-foreground sm:text-[19px]">
        {medida.partes.map((parte, i) => (
          <span key={i} className="whitespace-nowrap">
            {i > 0 && <span className="mr-1.5 text-texto-3">—</span>}
            {parte}
          </span>
        ))}
      </span>
      {medida.resto > 0 && (
        <Link
          href={`/catalogo/${product.slug}`}
          aria-label={`Ver las ${medida.resto + 1} medidas de ${product.name}`}
          className="tabular inline-flex h-6 items-center rounded-full bg-chip px-2 text-[12.5px] font-semibold text-texto-2 transition-colors hover:bg-linea"
        >
          +{medida.resto}
        </Link>
      )}
    </p>
  );
}
