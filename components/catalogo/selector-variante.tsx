"use client";

import { useState } from "react";
import { Check, Loader2, MessageCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Disponibilidad } from "@/components/catalogo/disponibilidad";
import { useCarrito } from "@/lib/carrito-context";
import { formatearPrecio } from "@/lib/formato";
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
          <p className="mb-2 text-sm font-semibold">
            Medida
            <span className="ml-1.5 font-normal text-muted-foreground">
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
                  className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    activa
                      ? "border-brand-orange bg-brand-orange/10 font-medium text-brand-orange-dark"
                      : "hover:border-brand-orange/40"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    {activa && <Check className="h-3.5 w-3.5" />}
                    {v.label}
                  </span>
                  {agotada && (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      Sin stock
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Precio de la medida elegida */}
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <p className="text-3xl font-bold text-brand-gray">
          {formatearPrecio(elegida.precio)}
        </p>
        <p className="text-xs text-muted-foreground">
          por {unit.replace("_", " ")}
          {elegida.material && ` · ${elegida.material}`}
          {elegida.color && ` · ${elegida.color}`}
        </p>

        <div className="mt-3 border-t pt-3">
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
          <div className="flex items-center gap-3">
            <div className="flex items-center rounded-lg border">
              <button
                onClick={() => setCantidad((c) => Math.max(1, c - 1))}
                className="px-3.5 py-2.5 text-lg leading-none transition-colors hover:bg-muted"
                aria-label="Quitar uno"
              >
                −
              </button>
              <span className="tabular w-12 text-center text-sm font-medium">
                {cantidad}
              </span>
              <button
                onClick={() => setCantidad((c) => c + 1)}
                className="px-3.5 py-2.5 text-lg leading-none transition-colors hover:bg-muted"
                aria-label="Agregar uno"
              >
                +
              </button>
            </div>

            <Button
              size="lg"
              disabled={guardando}
              className="flex-1 bg-brand-orange text-white hover:bg-brand-orange-dark"
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

      <p className="text-center text-[11px] text-muted-foreground">
        Código {elegida.sku}
      </p>
    </div>
  );
}
