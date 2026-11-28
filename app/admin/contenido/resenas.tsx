"use client";

import { useActionState } from "react";
import { AlertCircle, Check, Star, X } from "lucide-react";
import type { ResenaParaModerar } from "@/lib/dal/admin/contenido";
import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { moderarResena, type EstadoContenido } from "./actions";

const inicial: EstadoContenido = {};

/**
 * Moderación de reseñas.
 *
 * Todas vienen de una compra entregada: el modelo no admite otra cosa. Lo que
 * se revisa acá es qué escribieron, porque el texto sale firmado en la ficha
 * del producto.
 *
 * Nada se publica solo. Es la misma razón por la que los cuatro testimonios
 * inventados del prototipo están ocultos: lo que el sitio afirma en voz alta
 * tiene que haberlo mirado alguien.
 *
 * Arriba solo las pendientes; las ya moderadas van plegadas debajo, con la
 * acción en un tono secundario. Con todas juntas, a fin de mes la pendiente se
 * perdía entre rechazadas que tenían cada una un «Publicar» verde grande
 * (mes simulado, M2S4-056).
 */
export function Resenas({ resenas }: { resenas: ResenaParaModerar[] }) {
  const [estado, moderar] = useActionState(moderarResena, inicial);

  const pendientes = resenas.filter((r) => r.estado === "pendiente");
  const moderadas = resenas.filter((r) => r.estado !== "pendiente");

  return (
    <section className="tarjeta overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-4">
        <h2 className="text-base font-medium">Reseñas</h2>
        <p className="text-base text-muted-foreground">
          {pendientes.length > 0
            ? `${pendientes.length} esperando revisión`
            : "Nada pendiente"}
        </p>
      </div>

      {estado.error && (
        <p className="flex items-start gap-2 border-b bg-destructive/10 px-5 py-3 text-base text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {estado.error}
        </p>
      )}
      {estado.ok && !estado.error && (
        <p className="flex items-start gap-2 border-b bg-brand-green/10 px-5 py-3 text-base text-brand-green">
          <Check className="mt-0.5 h-4 w-4 shrink-0" />
          {estado.ok}
        </p>
      )}

      {resenas.length === 0 ? (
        <p className="px-5 py-8 text-base text-muted-foreground">
          {/* Solo puede dejar una quien compró el producto y ya lo recibió. */}
          Todavía no hay reseñas.
        </p>
      ) : (
        <>
          {pendientes.length > 0 && (
            <ul className="divide-y">
              {pendientes.map((r) => (
                <li key={r.id} className="px-5 py-4">
                  <Cabecera resena={r} />
                  {/* Una sola forma con los dos botones: el que se toca manda
                      su estado, y el motivo viaja solo si se rechaza. */}
                  <form action={moderar} className="mt-3 space-y-2">
                    <input type="hidden" name="id" value={r.id} />
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="submit"
                        name="estado"
                        value="publicada"
                        className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
                      >
                        <Check className="h-4 w-4 text-brand-green" />
                        Publicar
                      </button>
                      <button
                        type="submit"
                        name="estado"
                        value="rechazada"
                        className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
                      >
                        <X className="h-4 w-4 text-destructive" />
                        Rechazar
                      </button>
                    </div>
                    <input
                      name="motivo"
                      aria-label="Motivo del rechazo"
                      placeholder="Motivo del rechazo (opcional)"
                      className="h-11 w-full rounded-lg border bg-background px-3 text-base"
                    />
                  </form>
                </li>
              ))}
            </ul>
          )}

          {moderadas.length > 0 && (
            <details className={`group ${pendientes.length > 0 ? "border-t" : ""}`}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-base text-muted-foreground hover:bg-muted/40">
                <span>
                  {resumenModeradas(moderadas)}
                </span>
                <span aria-hidden className="transition-transform group-open:rotate-90">›</span>
              </summary>
              <ul className="divide-y border-t">
                {moderadas.map((r) => (
                  <li key={r.id} className="px-5 py-4">
                    <Cabecera resena={r} />
                    {r.motivoRechazo && (
                      <p className="mt-1 text-base text-muted-foreground">
                        Motivo: {r.motivoRechazo}
                      </p>
                    )}
                    <form action={moderar} className="mt-2">
                      <input type="hidden" name="id" value={r.id} />
                      <input
                        type="hidden"
                        name="estado"
                        value={r.estado === "publicada" ? "rechazada" : "publicada"}
                      />
                      <button
                        type="submit"
                        className="inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-base text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
                      >
                        {r.estado === "publicada" ? "Sacarla del sitio" : "Publicarla"}
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

function resumenModeradas(moderadas: ResenaParaModerar[]): string {
  const publicadas = moderadas.filter((r) => r.estado === "publicada").length;
  const rechazadas = moderadas.length - publicadas;
  return [
    publicadas > 0 ? `${publicadas} ${publicadas === 1 ? "publicada" : "publicadas"}` : null,
    rechazadas > 0 ? `${rechazadas} ${rechazadas === 1 ? "rechazada" : "rechazadas"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Producto, estrellas y quién la dejó. Las estrellas van del tamaño del texto,
 * la vacía en contorno: a 10 px la quinta gris no se distinguía de las
 * naranjas (M3S1-032). El número de pedido no se corta.
 */
function Cabecera({ resena: r }: { resena: ResenaParaModerar }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-base font-medium">{r.producto}</span>
        <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${r.estrellas} de 5 estrellas`}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Star
              key={n}
              aria-hidden
              className={
                n <= r.estrellas
                  ? "h-[18px] w-[18px] fill-brand-orange text-brand-orange"
                  : "h-[18px] w-[18px] text-muted-foreground/60"
              }
            />
          ))}
        </span>
        {r.estado !== "pendiente" && (
          <EtiquetaEstado estado={r.estado === "rechazada" ? "resena_rechazada" : r.estado} />
        )}
      </div>
      <p className="mt-0.5 text-base text-muted-foreground">
        {r.nombre} · <span className="codigo whitespace-nowrap">{r.numeroPedido}</span>
      </p>
      {r.texto && (
        <p className="mt-1.5 text-base text-muted-foreground">“{r.texto}”</p>
      )}
    </>
  );
}
