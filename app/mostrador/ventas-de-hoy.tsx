"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Printer, Undo2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatearMonto } from "@/lib/formato";
import { anularVenta } from "./actions";
import type { VentaDeHoy } from "./tipos";

/**
 * Las ventas de hoy, con la posibilidad de deshacerlas.
 *
 * El mostrador no tiene historial: tiene "lo que pasó hoy". Las anuladas van
 * tachadas y no escondidas, porque esconderlas hace que el mismo error se anule
 * dos veces.
 */
export function VentasDeHoy({ ventas }: { ventas: VentaDeHoy[] }) {
  const router = useRouter();
  const [trabajando, empezar] = useTransition();
  const [anulando, setAnulando] = useState<VentaDeHoy | null>(null);
  const [motivo, setMotivo] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);

  if (ventas.length === 0) return null;

  return (
    <section className="mt-6">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Ventas de hoy
      </h3>

      {aviso && <p className="mt-2 rounded-xl bg-hundida p-3.5 text-base">{aviso}</p>}

      <ul className="mt-2 divide-y divide-linea">
        {ventas.map((v) => {
          const anulada = v.estado === "cancelado";
          return (
            <li key={v.id} className="flex items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate text-base ${anulada ? "text-muted-foreground line-through" : ""}`}
                >
                  {v.numero} · {v.cliente}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {new Date(v.createdAt).toLocaleTimeString("es-AR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {v.medioPago ? ` · ${v.medioPago.replace("_", " ")}` : ""}
                </span>
              </span>

              <span
                className={`tabular shrink-0 font-semibold ${anulada ? "text-muted-foreground line-through" : ""}`}
              >
                {formatearMonto(v.total)}
              </span>

              <Link
                href={`/ticket/${v.id}`}
                target="_blank"
                aria-label={`Imprimir ${v.numero}`}
                className="shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-hundida hover:text-foreground"
              >
                <Printer className="h-4 w-4" />
              </Link>

              {!anulada && (
                <button
                  onClick={() => {
                    setAnulando(v);
                    setMotivo("");
                  }}
                  aria-label={`Anular ${v.numero}`}
                  className="shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-hundida hover:text-foreground"
                >
                  <Undo2 className="h-4 w-4" />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {anulando && (
        <Dialog open onOpenChange={(abierto) => !abierto && setAnulando(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-xl font-bold tracking-tight">
                Anular {anulando.numero}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-3.5">
              <p className="text-base leading-relaxed text-muted-foreground">
                Vuelve el stock, sale la plata de la caja y se cancela la deuda si
                la había. Nada se borra: queda todo asentado al revés.
              </p>

              <label className="block">
                <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Por qué
                </span>
                <input
                  autoFocus
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Se cargó la medida equivocada"
                  className="mt-1.5 h-12 w-full rounded-lg border border-linea bg-background px-3 text-base"
                />
              </label>

              <button
                disabled={trabajando || !motivo.trim()}
                onClick={() =>
                  empezar(async () => {
                    const r = await anularVenta(anulando.id, motivo);
                    setAviso(
                      r.error ?? [r.ok, r.avisoFiscal].filter(Boolean).join(" "),
                    );
                    if (!r.error) {
                      setAnulando(null);
                      router.refresh();
                    }
                  })
                }
                className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-accion text-lg font-bold text-white transition-colors hover:bg-accion-hover disabled:opacity-40"
              >
                <Undo2 className="h-5 w-5" />
                Anular la venta
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
