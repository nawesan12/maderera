"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Minus,
  Plus,
  RefreshCw,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCarrito } from "@/lib/carrito-context";
import { actualizarPrecios } from "@/app/(public)/carrito-actions";
import { formatearPrecio } from "@/lib/formato";

export default function PresupuestoPage() {
  const {
    items,
    subtotal,
    conPrecioDesactualizado,
    cambiar,
    quitar,
    vaciar,
    guardando,
  } = useCarrito();

  const [actualizando, setActualizando] = useState(false);

  const mensajeWhatsapp = encodeURIComponent(
    `Hola! Quiero un presupuesto por:\n\n${items
      .map(
        (i) =>
          `· ${i.descripcion}: ${i.cantidad} ${i.unidad.replace("_", " ")}`,
      )
      .join("\n")}\n\nGracias.`,
  );

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-brand-cream/30">
        <Encabezado cantidad={0} />
        <div className="container mx-auto px-4 py-16">
          <Card className="mx-auto max-w-lg border-0 shadow-sm">
            <CardContent className="p-12 text-center">
              <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-brand-orange/10">
                <ShoppingCart className="h-9 w-9 text-brand-orange" />
              </div>
              <h2 className="mb-2 text-xl font-bold">
                Tu presupuesto está vacío
              </h2>
              <p className="mb-6 text-muted-foreground">
                Agregá productos del catálogo o usá la calculadora para que te
                digamos cuánto material necesitás.
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <Link href="/catalogo">
                  <Button className="bg-brand-orange text-white hover:bg-brand-orange-dark">
                    Ver el catálogo
                  </Button>
                </Link>
                <Link href="/calculadora">
                  <Button variant="outline">Calcular materiales</Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-cream/30">
      <Encabezado cantidad={items.length} />

      <div className="container mx-auto px-4 py-8">
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          {/* Ítems */}
          <div>
            {conPrecioDesactualizado > 0 && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="flex items-start gap-2 text-sm text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {conPrecioDesactualizado === 1
                    ? "El precio de un producto cambió desde que lo agregaste."
                    : `Cambió el precio de ${conPrecioDesactualizado} productos desde que los agregaste.`}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={actualizando}
                  onClick={async () => {
                    setActualizando(true);
                    await actualizarPrecios();
                    setActualizando(false);
                  }}
                >
                  <RefreshCw
                    className={`h-4 w-4 ${actualizando ? "animate-spin" : ""}`}
                  />
                  Actualizar precios
                </Button>
              </div>
            )}

            <Card className="border-0 shadow-sm">
              <CardContent className="p-0">
                <ul className="divide-y">
                  {items.map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-wrap items-center gap-4 p-4"
                    >
                      <div className="min-w-48 flex-1">
                        {item.slug ? (
                          <Link
                            href={`/catalogo/${item.slug}`}
                            className="font-medium hover:text-brand-orange"
                          >
                            {item.descripcion}
                          </Link>
                        ) : (
                          <p className="font-medium">{item.descripcion}</p>
                        )}
                        <p className="text-sm text-muted-foreground">
                          {item.origen === "calculadora"
                            ? "Calculado según tus medidas"
                            : item.unidad.replace("_", " ")}
                          {item.precioActual !== null &&
                            ` · ${formatearPrecio(String(item.precioActual))} por ${item.unidad.replace("_", " ")}`}
                        </p>
                      </div>

                      <div className="flex items-center rounded-full bg-muted">
                        <button
                          onClick={() => cambiar(item.id, item.cantidad - 1)}
                          disabled={guardando}
                          className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-background disabled:opacity-50"
                          aria-label={`Quitar uno de ${item.descripcion}`}
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <span className="tabular w-12 text-center text-sm font-medium">
                          {item.cantidad}
                        </span>
                        <button
                          onClick={() => cambiar(item.id, item.cantidad + 1)}
                          disabled={guardando}
                          className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-background disabled:opacity-50"
                          aria-label={`Agregar uno de ${item.descripcion}`}
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>

                      <p className="tabular w-28 text-right font-semibold">
                        {item.subtotal > 0
                          ? formatearPrecio(String(item.subtotal))
                          : "A consultar"}
                      </p>

                      <button
                        onClick={() => quitar(item.id)}
                        disabled={guardando}
                        className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive disabled:opacity-50"
                        aria-label={`Sacar ${item.descripcion} del presupuesto`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <Link
                href="/catalogo"
                className="text-sm text-brand-orange hover:underline"
              >
                Seguir agregando productos
              </Link>
              <Button
                variant="ghost"
                size="sm"
                onClick={vaciar}
                disabled={guardando}
                className="text-muted-foreground hover:text-destructive"
              >
                Vaciar presupuesto
              </Button>
            </div>
          </div>

          {/* Resumen */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <Card className="border-0 shadow-sm">
              <CardContent className="p-6">
                <h2 className="mb-4 font-semibold">Resumen</h2>

                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">
                      {items.length === 1 ? "1 producto" : `${items.length} productos`}
                    </dt>
                    <dd className="tabular font-medium">
                      {formatearPrecio(String(subtotal))}
                    </dd>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <dt>Envío</dt>
                    <dd>Se calcula al finalizar</dd>
                  </div>
                </dl>

                <div className="mt-4 flex items-baseline justify-between border-t pt-4">
                  <span className="font-semibold">Total estimado</span>
                  <span className="tabular text-2xl font-bold">
                    {formatearPrecio(String(subtotal))}
                  </span>
                </div>

                <div className="mt-6 space-y-2.5">
                  <Link href="/checkout" className="block">
                    <Button
                      className="w-full bg-brand-orange text-white hover:bg-brand-orange-dark"
                      size="lg"
                    >
                      Finalizar compra
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>

                  <a
                    href={`https://wa.me/542235903118?text=${mensajeWhatsapp}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                  >
                    <Button variant="outline" className="w-full" size="lg">
                      Pedir presupuesto por WhatsApp
                    </Button>
                  </a>
                </div>

                <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                  Los precios pueden variar hasta confirmar el pedido. Para
                  cortes a medida y productos especiales te pasamos la cotización
                  por WhatsApp.
                </p>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Encabezado({ cantidad }: { cantidad: number }) {
  return (
    <div className="bg-brand-gray py-12 text-white">
      <div className="container mx-auto px-4">
        <h1 className="text-3xl font-bold">Tu presupuesto</h1>
        <p className="text-white/70">
          {cantidad === 0
            ? "Todavía no agregaste nada."
            : `${cantidad === 1 ? "1 producto listo" : `${cantidad} productos listos`} para pedir.`}
        </p>
      </div>
    </div>
  );
}
