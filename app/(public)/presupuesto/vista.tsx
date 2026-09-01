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
import { PrecioSinImpuestos } from "@/components/precio-sin-impuestos";
import { PedirPresupuesto, type SucursalElegible } from "./pedir";

/**
 * La pantalla del presupuesto en curso.
 *
 * Es un componente de cliente porque todo acá es interacción: subir y bajar
 * cantidades con respuesta inmediata. Los datos que necesita del servidor
 * —sucursales, quién está mirando— los recibe de `page.tsx`.
 */
export function VistaPresupuesto({
  sucursales,
  contacto,
  esProfesional,
  whatsapp,
}: {
  sucursales: SucursalElegible[];
  contacto: { nombre?: string | null; email?: string | null; telefono?: string | null };
  esProfesional: boolean;
  /** Número del negocio, en dígitos: es editable desde el panel. */
  whatsapp: string;
}) {
  const {
    items,
    subtotal,
    conPrecioDesactualizado,
    ahorroPorVolumen,
    listaDiferenciada,
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
      <div className="min-h-screen bg-sitio-alt">
        <Encabezado cantidad={0} />
        <div className="contenedor py-16">
          <Card className="mx-auto max-w-lg rounded-[14px] border border-linea shadow-[0_1px_2px_rgb(60_50_40_/_0.05)]">
            <CardContent className="p-12 text-center">
              <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-[18px] bg-naranja-claro">
                <ShoppingCart className="h-9 w-9 text-acento-texto" />
              </div>
              <h2 className="mb-2 text-xl font-bold">
                Tu presupuesto está vacío
              </h2>
              <p className="mb-6 text-muted-foreground">
                Agregá productos del catálogo o usá la calculadora para que te
                digamos cuánto material necesitás.
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <Button
                  render={<Link href="/catalogo" />}
                  className="h-11 rounded-[10px] bg-accion px-5 font-semibold text-white hover:bg-accion-hover"
                >
                  Ver el catálogo
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-sitio-alt">
      <Encabezado cantidad={items.length} />

      <div className="contenedor pb-[70px] pt-6">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_344px] lg:items-start">
          {/* Ítems */}
          <div>
            {listaDiferenciada && (
              <p className="mb-4 rounded-xl border border-brand-green/30 bg-brand-green/5 px-4 py-3 text-sm">
                Estás viendo la lista <strong>{listaDiferenciada}</strong>
                {ahorroPorVolumen > 0 && (
                  <>
                    {" "}
                    y ya llevás{" "}
                    <strong>{formatearPrecio(String(ahorroPorVolumen))}</strong>{" "}
                    de ahorro por cantidad
                  </>
                )}
                .
              </p>
            )}

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

            <Card className="overflow-hidden rounded-[14px] border border-linea shadow-[0_1px_2px_rgb(60_50_40_/_0.05)]">
              <CardContent className="p-0">
                <ul className="divide-y divide-linea-tenue">
                  {items.map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-wrap items-center gap-3.5 px-5 py-4"
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
                        <p className="tabular mt-0.5 text-[13px] text-texto-3">
                          {item.unidad.replace("_", " ")}
                          {item.precioActual !== null &&
                            ` · ${formatearPrecio(String(item.precioActual))} por ${item.unidad.replace("_", " ")}`}
                        </p>
                        <ChipOrigen origen={item.origen} />

                        {/* El descuento por volumen se muestra en el renglón que
                            lo generó: enterarse recién en el total no explica
                            por qué conviene llevar más. */}
                        {item.descuento > 0 && item.precioSinDescuento && (
                          <p className="mt-0.5 text-sm">
                            <span className="rounded-full bg-brand-green/10 px-2 py-0.5 font-medium text-brand-green">
                              −{item.descuento}% por cantidad
                            </span>{" "}
                            <span className="text-muted-foreground line-through">
                              {formatearPrecio(String(item.precioSinDescuento))}
                            </span>
                          </p>
                        )}
                      </div>

                      <div className="flex h-11 items-center overflow-hidden rounded-[9px] border border-linea bg-card">
                        <button
                          onClick={() => cambiar(item.id, item.cantidad - 1)}
                          disabled={guardando}
                          className="flex h-full w-10 items-center justify-center transition-colors hover:bg-chip disabled:opacity-50"
                          aria-label={`Quitar uno de ${item.descripcion}`}
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <span className="tabular w-11 text-center text-[15.5px] font-semibold">
                          {item.cantidad}
                        </span>
                        <button
                          onClick={() => cambiar(item.id, item.cantidad + 1)}
                          disabled={guardando}
                          className="flex h-full w-10 items-center justify-center transition-colors hover:bg-chip disabled:opacity-50"
                          aria-label={`Agregar uno de ${item.descripcion}`}
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>

                      <p className="tabular w-[110px] text-right text-base font-semibold">
                        {item.subtotal > 0
                          ? formatearPrecio(String(item.subtotal))
                          : "A consultar"}
                      </p>

                      <button
                        onClick={() => quitar(item.id)}
                        disabled={guardando}
                        className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[9px] border border-linea-suave text-texto-3 transition-colors hover:text-rojo-oferta disabled:opacity-50"
                        aria-label={`Sacar ${item.descripcion} del presupuesto`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2.5">
              <Link
                href="/catalogo"
                className="flex h-11 items-center rounded-[9px] border border-linea bg-card px-4 text-[14.5px] font-semibold transition-colors hover:bg-sitio-alt"
              >
                Seguir agregando
              </Link>
              <Button
                variant="ghost"
                onClick={vaciar}
                disabled={guardando}
                className="h-11 rounded-[9px] px-4 text-[14.5px] text-texto-2 hover:text-destructive"
              >
                Vaciar presupuesto
              </Button>
            </div>
          </div>

          {/* Resumen */}
          <aside className="flex flex-col gap-3 lg:sticky lg:top-[92px] lg:self-start">
            <Card className="rounded-[14px] border border-linea shadow-[0_1px_2px_rgb(60_50_40_/_0.05)]">
              <CardContent className="p-5">
                <h2 className="text-xs font-bold uppercase tracking-[0.1em] text-texto-3">
                  Resumen
                </h2>

                <dl className="mt-3.5 flex flex-col gap-2.5 text-[15px]">
                  <div className="flex justify-between gap-3">
                    <dt className="text-texto-2">
                      {items.length === 1 ? "1 producto" : `${items.length} productos`}
                    </dt>
                    <dd className="tabular font-semibold">
                      {formatearPrecio(String(subtotal))}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-texto-2">Envío</dt>
                    <dd className="text-sm text-texto-3">
                      se calcula al finalizar
                    </dd>
                  </div>
                </dl>

                <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-linea-suave pt-3">
                  <span className="text-[17px] font-semibold">
                    Total estimado
                  </span>
                  <span className="tabular text-[22px] font-bold tracking-[-0.02em]">
                    {formatearPrecio(String(subtotal))}
                  </span>
                </div>

                {/* Ley 27.743: el neto también acá, que es donde se mira el
                    número que se va a pagar. */}
                <PrecioSinImpuestos precioFinal={subtotal} className="mt-2" />

                <div className="mt-4 space-y-2.5">
                  <Button
                    render={<Link href="/checkout" />}
                    className="h-[52px] w-full rounded-[10px] bg-accion text-base font-semibold text-white hover:bg-accion-hover"
                  >
                    Continuar con el pedido
                    <ArrowRight className="h-4 w-4" />
                  </Button>

                  {/* Dos caminos y los dos hacen falta: por escrito queda
                      registrado con número y cae en el panel; por WhatsApp es
                      lo que la gente hace igual, y forzarla al formulario
                      pierde el pedido. */}
                  <PedirPresupuesto
                    sucursales={sucursales}
                    nombre={contacto.nombre}
                    email={contacto.email}
                    telefono={contacto.telefono}
                    esProfesional={esProfesional}
                  />

                  <a
                    href={`https://wa.me/${whatsapp}?text=${mensajeWhatsapp}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                  >
                    <Button
                      variant="ghost"
                      className="h-11 w-full rounded-[10px] font-semibold"
                    >
                      Pedirlo por WhatsApp
                    </Button>
                  </a>
                </div>

                <p className="mt-3.5 text-xs leading-relaxed text-texto-3">
                  Los precios pueden variar hasta confirmar el pedido. Para
                  cortes a medida y productos especiales te pasamos la cotización
                  por WhatsApp.
                </p>
              </CardContent>
            </Card>

            {/* El aviso solo tiene sentido para quien todavía no tiene la
                cuenta: a un profesional aprobado la lista ya se le aplicó, y se
                lo dice el cartel de arriba de la lista. */}
            {!esProfesional && (
              <section className="rounded-xl border border-[#f5d9b8] bg-naranja-claro px-[18px] py-4 dark:border-brand-orange/25">
                <p className="text-[14.5px] font-semibold text-acento-sobre-claro">
                  ¿Sos profesional?
                </p>
                <p className="mt-1.5 text-[13.5px] leading-normal text-acento-sobre-claro">
                  Con cuenta habilitada este presupuesto sale con tu escala de
                  descuento aplicada.
                </p>
              </section>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

/**
 * Etiqueta de dónde salió cada renglón.
 *
 * Un ítem de la calculadora es una estimación a partir de medidas y uno del
 * catálogo es un producto elegido: cuando hay que revisar el presupuesto,
 * saber cuál es cuál cambia qué se mira.
 */
function ChipOrigen({ origen }: { origen: string }) {
  const texto =
    origen === "calculadora"
      ? "De la calculadora"
      : origen === "catalogo"
        ? "Del catálogo"
        : origen === "repetido"
          ? "De un pedido anterior"
          : "A medida";

  return (
    <span className="mt-1.5 inline-flex items-center rounded-md bg-naranja-claro px-2 py-0.5 text-[11.5px] font-medium text-acento-sobre-claro">
      {texto}
    </span>
  );
}

function Encabezado({ cantidad }: { cantidad: number }) {
  return (
    <div className="contenedor pt-10">
      <h1 className="text-[34px] font-bold tracking-[-0.03em]">
        Tu presupuesto
      </h1>
      <p className="mt-1.5 text-base text-texto-2">
        {cantidad === 0
          ? "Todavía no agregaste nada."
          : `${cantidad === 1 ? "1 ítem" : `${cantidad} ítems`} · los precios se confirman cuando te respondemos`}
      </p>
    </div>
  );
}
