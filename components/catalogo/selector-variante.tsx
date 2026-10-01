"use client";

import { useState } from "react";
import { Check, Loader2, MessageCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Disponibilidad } from "@/components/catalogo/disponibilidad";
import { useCarrito } from "@/lib/carrito-context";
import { formatearPrecio, formatearUnidad } from "@/lib/formato";
import { PrecioSecundario } from "@/components/precio";
import { presentarPrecio, type VistaDePrecio } from "@/lib/precios/vista";
import {
  usePreciosPorVariante,
  useVistaPropia,
} from "@/lib/precios-propios-context";
import type { VarianteDetalle } from "@/lib/dal/catalog";
import {
  admiteMedia,
  areaDePlacaM2,
  nombreDePresentacion,
  precioDeLinea,
  seVendePorM2,
  unidadDeLinea,
  type FormaDeVenta,
  type Presentacion,
} from "@/lib/ventas/forma-de-venta";
import { admiteDecimales, formatearCantidad, leerCantidad, pasoDeCantidad } from "@/lib/unidades";

/**
 * Elección de medida y compra.
 *
 * Cada medida tiene su precio y su stock, así que la elección cambia lo que se
 * paga y si está disponible. Por eso el precio y la disponibilidad se muestran
 * junto al selector y se actualizan al elegir, en vez de mostrar un "desde" que
 * después no coincide con lo que se cobra.
 */
export function SelectorVariante({
  productName,
  unit,
  variantes,
  whatsapp,
  alicuota = 21,
  vista = "final",
  aPedido = false,
  formaDeVenta = "entera",
  precioMediaPct = 50,
}: {
  productName: string;
  unit: string;
  variantes: VarianteDetalle[];
  whatsapp: string;
  /** La del producto. Sin esto el neto informado se calcula siempre al 21 %. */
  alicuota?: number;
  /**
   * Con IVA o sin IVA.
   *
   * Es lo que mandó el servidor —siempre «final», que es lo que corresponde
   * mostrarle al público— y el punto de partida: si quien mira tiene otra
   * vista, la corrige `useVistaPropia` sin volver al servidor.
   */
  vista?: VistaDePrecio;
  /**
   * Se fabrica a pedido: no falta, se hace.
   *
   * Son los maquinados especiales del brief —escaleras a medida, tirantes en
   * medidas que no vienen de origen—. Sin esto la ficha solo podía decir "no
   * tenemos stock", que para este producto es directamente falso y espanta a
   * quien justamente venía a encargarlo.
   */
  aPedido?: boolean;
  /** Cómo se vende la placa (nota de la clienta del 30/9/2026). */
  formaDeVenta?: FormaDeVenta;
  precioMediaPct?: number;
}) {
  const { agregar, guardando } = useCarrito();
  const [medida, setMedida] = useState(variantes[0]);
  const [cantidad, setCantidad] = useState(1);
  /** Lo que se está tipeando en la cantidad, para dejar escribir «2,» a medias. */
  const [cantidadTexto, setCantidadTexto] = useState("1");
  const [presentacion, setPresentacion] = useState<Presentacion>(null);

  const producto = { unit, formaDeVenta, precioMediaPct };
  const conMedia = admiteMedia(producto);
  const porM2 = seVendePorM2(producto);
  const unidadVendida = unidadDeLinea(producto);
  // Metros y m² se piden con decimales; placas, tablas y bisagras, enteras.
  const fraccionable = admiteDecimales(unidadVendida) && unidadVendida !== "placa";
  const paso = fraccionable ? pasoDeCantidad(unidadVendida) : 1;

  function fijarCantidad(n: number) {
    const valor = Math.max(paso, Math.round(n * 100) / 100);
    setCantidad(valor);
    setCantidadTexto(formatearCantidad(valor));
  }

  /*
   * El precio del profesional pisa al de público, medida por medida.
   *
   * La ficha llega con el precio de público —así se sirve de la caché, igual
   * que el catálogo— y esto lo reemplaza para quien tiene lista propia. Para
   * todos los demás el mapa está vacío y no cambia nada.
   *
   * **Es solo lo que se ve.** Lo que se cobra lo recalcula el servidor con la
   * lista real al agregar al carrito; acá viaja el id de la variante, nunca un
   * precio.
   */
  const propios = usePreciosPorVariante();
  const vistaVigente = useVistaPropia() ?? vista;

  const conPrecioPropio = (v: VarianteDetalle): VarianteDetalle =>
    propios[v.id] ? { ...v, precio: propios[v.id] } : v;

  const elegida = medida ? conPrecioPropio(medida) : medida;
  const setElegida = setMedida;

  // El precio de lo que se está eligiendo: la media placa vale su porcentaje.
  const precioElegido = precioDeLinea(
    Number(elegida?.precio ?? 0),
    producto,
    conMedia ? presentacion : null,
  );
  const mostrado = presentarPrecio(precioElegido, alicuota, vistaVigente);
  const area = porM2 ? areaDePlacaM2(elegida?.largoMm, elegida?.anchoMm) : null;

  if (!elegida) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Este producto todavía no tiene medidas cargadas.
        </p>
        <a href={whatsapp} target="_blank" rel="noopener noreferrer">
          <Button variant="outline" className="mt-3">
            <MessageCircle className="h-4 w-4" />
            Consultar por WhatsApp
          </Button>
        </a>
      </div>
    );
  }

  const sinPrecio = !elegida.precio || Number(elegida.precio) <= 0;
  const sinStock =
    elegida.stockCentral === "sin-stock" &&
    elegida.stockAserradero === "sin-stock";
  const subtotal = sinPrecio ? 0 : precioElegido * cantidad;

  return (
    <div className="space-y-5">
      {variantes.length > 1 && (
        <div>
          <p className="mb-2.5 text-[15px] font-semibold">
            Medida
            <span className="ml-1.5 font-normal text-texto-3">
              ({variantes.length} opciones)
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            {variantes.map((v) => {
              const activa = v.id === elegida.id;
              const agotada =
                v.stockCentral === "sin-stock" &&
                v.stockAserradero === "sin-stock";

              return (
                <button
                  key={v.id}
                  onClick={() => setElegida(v)}
                  aria-pressed={activa}
                  className={`rounded-[10px] px-3.5 py-2.5 text-left transition-colors ${
                    activa
                      ? "border-[1.5px] border-accion bg-naranja-claro font-semibold text-acento-texto"
                      : agotada
                        ? "border border-linea bg-chip text-texto-3"
                        : "border border-linea bg-card hover:border-accion/40"
                  }`}
                >
                  <span className="tabular flex items-center gap-1.5 text-[14.5px]">
                    {activa && <Check className="h-3.5 w-3.5" />}
                    {v.label}
                  </span>
                  {agotada && (
                    <span className="mt-0.5 block text-[11.5px] text-texto-3">
                      sin existencia
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Entera o media: dos precios distintos sobre la misma medida, así que
          se elige antes de ver el precio, igual que la medida. */}
      {conMedia && (
        <div>
          <p className="mb-2.5 text-[15px] font-semibold">Cómo la querés</p>
          <div className="flex flex-wrap gap-2">
            {([null, "media_largo", "media_ancho"] as const).map((p) => {
              const activa = presentacion === p;
              return (
                <button
                  key={p ?? "entera"}
                  onClick={() => setPresentacion(p)}
                  aria-pressed={activa}
                  className={`rounded-[10px] px-3.5 py-2.5 text-left text-[14.5px] transition-colors ${
                    activa
                      ? "border-[1.5px] border-accion bg-naranja-claro font-semibold text-acento-texto"
                      : "border border-linea bg-card hover:border-accion/40"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    {activa && <Check className="h-3.5 w-3.5" />}
                    {p === null
                      ? "Placa entera"
                      : p === "media_largo"
                        ? "Media, al largo"
                        : "Media, al ancho"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Precio de la medida elegida */}
      <div className="rounded-[14px] border border-linea bg-card px-[22px] py-5 shadow-[0_1px_2px_rgb(60_50_40_/_0.05)]">
        <p className="flex items-baseline gap-2">
          <span className="tabular text-4xl font-bold leading-none tracking-[-0.03em]">
            {formatearPrecio(String(mostrado.principal))}
          </span>
          {mostrado.sufijo && (
            <span className="text-base font-semibold text-texto-2">
              {mostrado.sufijo}
            </span>
          )}
        </p>
        <p className="mt-1.5 text-[14.5px] text-texto-2">
          {conMedia && presentacion
            ? nombreDePresentacion(presentacion)?.toLowerCase()
            : `por ${formatearUnidad(unidadVendida)}`}
          {vistaVigente === "final" && " · IVA incluido"}
          {elegida.material && ` · ${elegida.material}`}
          {elegida.color && ` · ${elegida.color}`}
          {elegida.terminacion && ` · ${elegida.terminacion}`}
          {elegida.calidad && ` · ${elegida.calidad}`}
        </p>
        {/* Por m², la cuenta que el cliente hace de cabeza: cuánto es una
            placa. Sin esto «$9.800 el m²» no dice cuánto sale la placa. */}
        {porM2 && area && (
          <p className="tabular mt-1 text-[14.5px] text-texto-2">
            Placa de {formatearCantidad((elegida.largoMm ?? 0) / 1000)} ×{" "}
            {formatearCantidad((elegida.anchoMm ?? 0) / 1000)} m ={" "}
            {formatearCantidad(Math.round(area * 100) / 100)} m² ·{" "}
            {formatearPrecio(String(Math.round(precioElegido * area)))} la placa
          </p>
        )}
        <PrecioSecundario
          precioFinal={precioElegido}
          alicuota={alicuota}
          vista={vistaVigente}
          className="mt-1"
        />

        <div className="mt-3.5 border-t border-linea-tenue pt-3.5">
          <Disponibilidad
            central={elegida.stockCentral}
            aserradero={elegida.stockAserradero}
            cantidad={elegida.disponibles}
          />
        </div>
      </div>

      {sinPrecio || sinStock ? (
        <div className="rounded-xl border border-dashed p-4 text-center">
          <p className="text-sm text-muted-foreground">
            {aPedido
              ? "Se fabrica a pedido, en nuestra planta. Escribinos con la medida y te pasamos el plazo."
              : sinPrecio
                ? "Este producto se cotiza según la medida y el trabajo."
                : "Ahora mismo no tenemos stock de esta medida."}
          </p>
          <a
            href={whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block"
          >
            <Button className="bg-brand-green text-white hover:bg-brand-green/90">
              <MessageCircle className="h-4 w-4" />
              {sinPrecio ? "Pedir cotización" : "Consultar disponibilidad"}
            </Button>
          </a>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2.5">
            <div className="flex h-[50px] items-center overflow-hidden rounded-[10px] border border-linea bg-card">
              <button
                onClick={() => fijarCantidad(cantidad - 1)}
                className="h-full w-[46px] text-xl leading-none transition-colors hover:bg-chip"
                aria-label="Quitar uno"
              >
                −
              </button>
              {/* Lo que se mide se puede tipear: 3,7 metros de zócalo no se
                  arman apretando «+». */}
              {fraccionable ? (
                <input
                  value={cantidadTexto}
                  inputMode="decimal"
                  aria-label={`Cantidad, en ${formatearUnidad(unidadVendida)}`}
                  onChange={(e) => {
                    setCantidadTexto(e.target.value);
                    const n = leerCantidad(e.target.value);
                    if (Number.isFinite(n) && n > 0) setCantidad(Math.round(n * 100) / 100);
                  }}
                  onBlur={() => fijarCantidad(cantidad)}
                  className="tabular h-full w-[64px] bg-transparent text-center text-[17px] font-semibold outline-none"
                />
              ) : (
                <span className="tabular w-[52px] text-center text-[17px] font-semibold">
                  {cantidad}
                </span>
              )}
              <button
                onClick={() => fijarCantidad(cantidad + 1)}
                className="h-full w-[46px] text-xl leading-none transition-colors hover:bg-chip"
                aria-label="Agregar uno"
              >
                +
              </button>
              {fraccionable && (
                <span className="pr-3 text-[14.5px] text-texto-2">
                  {formatearUnidad(unidadVendida)}
                </span>
              )}
            </div>

            <Button
              disabled={guardando}
              className="h-[50px] flex-1 rounded-[10px] bg-accion text-base font-semibold text-white hover:bg-accion-hover"
              onClick={() =>
                agregar({
                  variantId: elegida.id,
                  descripcion: `${productName} — ${elegida.label}`,
                  unidad: unidadVendida,
                  cantidad,
                  presentacion: conMedia ? presentacion : null,
                  origen: "catalogo",
                })
              }
            >
              {guardando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Agregar al presupuesto
            </Button>
          </div>

          {cantidad !== 1 && (
            <p className="text-center text-sm text-muted-foreground">
              {formatearCantidad(cantidad)} × {formatearPrecio(String(precioElegido))} ={" "}
              <span className="tabular font-semibold text-foreground">
                {formatearPrecio(String(subtotal))}
              </span>
            </p>
          )}
        </>
      )}

      <p className="tabular text-center text-xs text-texto-3">
        Código {elegida.sku}
      </p>
    </div>
  );
}
