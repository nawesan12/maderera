"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Barcode, ChevronDown, History } from "lucide-react";
import { NivelStock, TINTA_DEL_ESTADO, textoDelEstado } from "@/components/admin/nivel-stock";
import { formatearUnidad } from "@/lib/formato";
import { estadoEnSucursal } from "@/lib/stock-ajuste";
import { formatearCantidad } from "@/lib/unidades";
import type { FilaStock } from "@/lib/dal/admin/inventory";
import { AjusteRapido } from "./ajuste-rapido";

/**
 * Una medida en Stock.
 *
 * En el teléfono es una fila corta —nombre, medida, código, lo disponible y
 * una línea por sucursal— y el detalle con las barras y los botones se abre
 * al tocarla. Era una tarjeta de unos 650 px por medida, con −, + y Cargar
 * por sucursal: 27.000 px para 40 medidas (mes simulado, H013). Desde 640 px
 * el detalle va siempre a la vista.
 *
 * Sin foto no hay recuadro gris: le comía un tercio del ancho al nombre, que
 * quedaba de una palabra por renglón, y «en camino» se le montaba encima
 * (H397). «En camino» va en su propio renglón.
 */
export function TarjetaStock({
  fila,
  enCamino,
  verFicha,
}: {
  fila: FilaStock;
  enCamino?: { cantidad: number; llega: string | null };
  /** El depósito no entra a la ficha: el enlace lo rebotaba al inicio. */
  verFicha: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const unidad = formatearUnidad(fila.unidad);
  const detalle = `stock-${fila.variantId}`;

  return (
    <article className={`p-4 ${fila.paraReponer ? "tarjeta-atencion" : "tarjeta"}`}>
      <div className="flex items-start gap-3">
        {fila.imagen && (
          <EnlaceSi
            si={verFicha}
            href={`/admin/productos/${fila.productId}`}
            className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted sm:h-20 sm:w-20"
          >
            <Image src={fila.imagen} alt="" fill className="object-cover" sizes="80px" />
          </EnlaceSi>
        )}
        <div className="min-w-0 flex-1">
          <EnlaceSi
            si={verFicha}
            href={`/admin/productos/${fila.productId}`}
            className="text-base font-medium leading-snug break-words hover:text-brand-orange"
          >
            {fila.productName}
          </EnlaceSi>
          <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
            <span>{fila.label}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular">{fila.sku}</span>
            <Link
              href={`/admin/stock/etiquetas?m=${fila.variantId}`}
              aria-label={`Etiquetas de ${fila.productName} ${fila.label}`}
              title="Etiquetas"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted hover:text-foreground"
            >
              <Barcode className="h-4 w-4" aria-hidden="true" />
            </Link>
            {/* El historial de la medida: los movimientos filtrados por su
                código (H220). */}
            <Link
              href={`/admin/stock?buscar=${encodeURIComponent(fila.sku)}#movimientos`}
              aria-label={`Movimientos de ${fila.productName} ${fila.label}`}
              title="Movimientos"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted hover:text-foreground"
            >
              <History className="h-4 w-4" aria-hidden="true" />
            </Link>
          </p>
          {enCamino && (
            <p className="estado-espera tabular text-sm font-medium">
              +{formatearCantidad(enCamino.cantidad)} en camino
              {enCamino.llega
                ? ` · ${new Date(enCamino.llega).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}`
                : ""}
            </p>
          )}
        </div>
        <p className="shrink-0 text-right">
          <span className={`tabular block text-xl font-semibold ${fila.total < 0 ? "text-destructive" : ""}`}>
            {formatearCantidad(fila.total)}
          </span>
          <span className="block text-sm text-muted-foreground">{unidad}</span>
        </p>
      </div>

      {/* La fila corta del teléfono: una línea por sucursal, y al tocarla el
          detalle. */}
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        aria-expanded={abierto}
        aria-controls={detalle}
        className="mt-3 flex w-full items-start gap-3 rounded-lg bg-hundida px-3 py-2 text-left sm:hidden"
      >
        <span className="min-w-0 flex-1 space-y-1">
          {fila.sucursales.map((s) => {
            const estado = estadoEnSucursal(s.disponible, s.min);
            return (
              <span key={s.id} className="flex items-baseline justify-between gap-3 text-base">
                <span className="min-w-0 truncate text-muted-foreground">{s.nombre}</span>
                <span className="flex shrink-0 items-baseline gap-2">
                  {estado !== "bien" && estado !== "va-bajando" && (
                    <span className={`text-sm ${TINTA_DEL_ESTADO[estado]}`}>
                      {estado === "faltante" ? "Faltan" : textoDelEstado(estado, s.disponible)}
                    </span>
                  )}
                  <span className={`tabular font-semibold ${estado === "sin-stock" ? "text-muted-foreground" : TINTA_DEL_ESTADO[estado]}`}>
                    {formatearCantidad(estado === "faltante" ? -s.disponible : s.disponible)}
                  </span>
                </span>
              </span>
            );
          })}
        </span>
        <ChevronDown
          className={`mt-1 h-5 w-5 shrink-0 text-muted-foreground transition-transform ${abierto ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
        <span className="sr-only">{abierto ? "Cerrar" : "Ver"} el detalle</span>
      </button>

      {/* Una columna por sucursal activa de la base. */}
      <div
        id={detalle}
        className={`mt-3 gap-4 sm:grid sm:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] ${abierto ? "grid" : "hidden"}`}
      >
        {fila.sucursales.map((s) => (
          <div key={s.id}>
            <NivelStock
              sucursal={s.nombre}
              cantidad={s.qty}
              reservado={s.reservado}
              disponible={s.disponible}
              enReparto={s.enReparto}
              llegando={s.llegando}
              minimo={s.min}
              unidad={unidad}
              largoMm={fila.unidad === "metro_lineal" ? fila.largoMm : null}
            />
            <div className="mt-2">
              <AjusteRapido
                variantId={fila.variantId}
                producto={fila.productName}
                medida={fila.label}
                branchSlug={s.slug}
                galpon={s.qty - s.enReparto}
                unidad={fila.unidad}
                largoMm={fila.largoMm}
                sucursal={s.nombre}
              />
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

/** Un enlace, o el mismo contenido sin enlace para quien no puede entrar. */
function EnlaceSi({
  si,
  href,
  className,
  children,
}: {
  si: boolean;
  href: string;
  className: string;
  children: React.ReactNode;
}) {
  if (si) {
    return (
      <Link href={href} className={`block ${className}`}>
        {children}
      </Link>
    );
  }
  return <span className={`block ${className.replace(/hover:\S+/g, "")}`}>{children}</span>;
}
