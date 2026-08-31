"use client";

import { useState } from "react";
import { Check, Loader2, MessageCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Disponibilidad } from "@/components/catalogo/disponibilidad";
import { useCarrito } from "@/lib/carrito-context";
import { formatearPrecio, formatearUnidad } from "@/lib/formato";
import { PrecioSinImpuestos } from "@/components/precio-sin-impuestos";
import type { VarianteDetalle } from "@/lib/dal/catalog";

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
}: {
  productName: string;
  unit: string;
  variantes: VarianteDetalle[];
  whatsapp: string;
}) {
  const { agregar, guardando } = useCarrito();
  const [elegida, setElegida] = useState(variantes[0]);
  const [cantidad, setCantidad] = useState(1);

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
  const subtotal = sinPrecio ? 0 : Number(elegida.precio) * cantidad;

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

      {/* Precio de la medida elegida */}
      <div className="rounded-[14px] border border-linea bg-card px-[22px] py-5 shadow-[0_1px_2px_rgb(60_50_40_/_0.05)]">
        <p className="tabular text-4xl font-bold leading-none tracking-[-0.03em]">
          {formatearPrecio(elegida.precio)}
        </p>
        <p className="mt-1.5 text-[14.5px] text-texto-2">
          por {formatearUnidad(unit)} · IVA incluido
          {elegida.material && ` · ${elegida.material}`}
          {elegida.color && ` · ${elegida.color}`}
        </p>
        {/* Ley 27.743: el precio sin impuestos nacionales, junto al final. */}
        <PrecioSinImpuestos
          precioFinal={Number(elegida.precio)}
          className="mt-1"
        />

        <div className="mt-3.5 border-t border-linea-tenue pt-3.5">
          <Disponibilidad
            central={elegida.stockCentral}
            aserradero={elegida.stockAserradero}
          />
        </div>
      </div>

      {sinPrecio || sinStock ? (
        <div className="rounded-xl border border-dashed p-4 text-center">
          <p className="text-sm text-muted-foreground">
            {sinPrecio
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
                onClick={() => setCantidad((c) => Math.max(1, c - 1))}
                className="h-full w-[46px] text-xl leading-none transition-colors hover:bg-chip"
                aria-label="Quitar uno"
              >
                −
              </button>
              <span className="tabular w-[52px] text-center text-[17px] font-semibold">
                {cantidad}
              </span>
              <button
                onClick={() => setCantidad((c) => c + 1)}
                className="h-full w-[46px] text-xl leading-none transition-colors hover:bg-chip"
                aria-label="Agregar uno"
              >
                +
              </button>
            </div>

            <Button
              disabled={guardando}
              className="h-[50px] flex-1 rounded-[10px] bg-accion text-base font-semibold text-white hover:bg-accion-hover"
              onClick={() =>
                agregar({
                  variantId: elegida.id,
                  descripcion: `${productName} — ${elegida.label}`,
                  unidad: unit,
                  cantidad,
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

          {cantidad > 1 && (
            <p className="text-center text-sm text-muted-foreground">
              {cantidad} × {formatearPrecio(elegida.precio)} ={" "}
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
