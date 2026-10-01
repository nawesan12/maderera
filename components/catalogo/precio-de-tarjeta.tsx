import { formatearPrecio } from "@/lib/formato";
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

/** El descuento manda sobre «Destacado»: si está en oferta, es lo que hay que ver. */
export function EtiquetaDeTarjeta({
  product,
  propio,
}: {
  product: ProductoListado;
  propio: PrecioPropio | null;
}) {
  const { descuento } = vigente(product, propio);

  if (descuento !== null) {
    return (
      <span className="absolute left-3 top-3 rounded-full bg-rojo-oferta px-[11px] py-[5px] text-[12.5px] font-bold text-white shadow-[0_2px_8px_-2px_rgb(120_25_10_/_0.5)]">
        −{descuento}%
      </span>
    );
  }
  if (!product.featured) return null;
  return (
    <span className="absolute left-3 top-3 rounded-full bg-accion px-[11px] py-[5px] text-[10.5px] font-bold uppercase tracking-[0.1em] text-white shadow-sm">
      Destacado
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

  if (sinPrecio) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-[19px] font-bold tracking-[-0.02em] text-foreground">A consultar</p>
        <p className="text-xs text-texto-3">Te pasamos el precio por WhatsApp</p>
      </div>
    );
  }

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
