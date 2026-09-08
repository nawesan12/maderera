"use client";

import { useActionState } from "react";
import { AlertCircle, Check, X } from "lucide-react";
import type { ResenaParaModerar } from "@/lib/dal/admin/contenido";
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
 */
export function Resenas({ resenas }: { resenas: ResenaParaModerar[] }) {
  const [estado, moderar] = useActionState(moderarResena, inicial);

  const pendientes = resenas.filter((r) => r.estado === "pendiente");

  return (
    <section className="tarjeta">
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
          Todavía no hay reseñas. Solo puede dejar una quien compró el producto
          y ya lo recibió.
        </p>
      ) : (
        <ul className="divide-y">
          {resenas.map((r) => (
            <li key={r.id} className="px-5 py-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-base font-medium">{r.producto}</span>
                <span
                  className="tabular text-base text-brand-orange"
                  aria-label={`${r.estrellas} de 5 estrellas`}
                >
                  {"★".repeat(r.estrellas)}
                  <span className="text-muted-foreground">
                    {"★".repeat(5 - r.estrellas)}
                  </span>
                </span>
                <span className="text-base text-muted-foreground">
                  {r.nombre} · pedido {r.numeroPedido}
                </span>
                {r.estado !== "pendiente" && (
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-sm ${
                      r.estado === "publicada"
                        ? "bg-brand-green/10 text-brand-green"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {r.estado === "publicada" ? "publicada" : "rechazada"}
                  </span>
                )}
              </div>

              {r.texto && (
                <p className="mt-1.5 text-base text-muted-foreground">
                  “{r.texto}”
                </p>
              )}

              {r.motivoRechazo && (
                <p className="mt-1 text-base text-muted-foreground">
                  Motivo: {r.motivoRechazo}
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {r.estado !== "publicada" && (
                  <form action={moderar}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="estado" value="publicada" />
                    <button
                      type="submit"
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-green px-3 text-base font-medium text-white transition-opacity hover:opacity-90"
                    >
                      <Check className="h-4 w-4" />
                      Publicar
                    </button>
                  </form>
                )}

                {r.estado !== "rechazada" && (
                  <form action={moderar} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="estado" value="rechazada" />
                    <input
                      name="motivo"
                      placeholder="Motivo (opcional)"
                      className="h-9 w-52 rounded-lg border bg-background px-3 text-base"
                    />
                    <button
                      type="submit"
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-base transition-colors hover:bg-muted hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                      Rechazar
                    </button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
