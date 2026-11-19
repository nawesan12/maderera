"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Printer, Undo2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CampoPin, type Autorizacion } from "@/components/autorizacion/campo-pin";
import { formatearMonto, hora } from "@/lib/formato";
import { anularVenta } from "./actions";
import { NOMBRE_DEL_MEDIO } from "./medios";
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
  /*
   * ¿Volvió la mercadería? Preguntado siempre y con «Volvió» marcado: es lo
   * normal, y Enter confirma. «Se la llevó» no devuelve el stock y pide el
   * PIN de un admin (es mercadería que sale sin plata).
   */
  const [volvio, setVolvio] = useState(true);
  const [pidePin, setPidePin] = useState<Autorizacion | null>(null);

  function anular(pin?: string) {
    if (!anulando || !motivo.trim()) return;
    const venta = anulando;
    empezar(async () => {
      const r = await anularVenta(venta.id, motivo, { volvioLaMercaderia: volvio, pin });
      if (r.autorizacion) {
        setPidePin(r.autorizacion);
        return;
      }
      setPidePin(null);
      setAviso(r.error ?? [r.ok, r.avisoFiscal].filter(Boolean).join(" "));
      if (!r.error) {
        setAnulando(null);
        router.refresh();
      }
    });
  }

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
                  {/* En 24 h y con el nombre del medio, no su clave
                      («12:16 a. m. · cuenta corriente»): comité final. */}
                  {hora.format(new Date(v.createdAt))}
                  {v.medioPago ? ` · ${NOMBRE_DEL_MEDIO[v.medioPago] ?? v.medioPago}` : ""}
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
                    setVolvio(true);
                    setPidePin(null);
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

            <div
              className="space-y-3.5"
              onKeyDown={(e) => {
                // Alt + V y Alt + L eligen sin pasar al mouse.
                if (!e.altKey) return;
                if (e.code === "KeyV") {
                  e.preventDefault();
                  setVolvio(true);
                }
                if (e.code === "KeyL") {
                  e.preventDefault();
                  setVolvio(false);
                }
              }}
            >
              <label className="block">
                <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Por qué
                </span>
                <input
                  autoFocus
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !pidePin) {
                      e.preventDefault();
                      anular();
                    }
                  }}
                  placeholder="Se cargó la medida equivocada"
                  className="mt-1.5 h-12 w-full rounded-lg border border-linea bg-background px-3 text-base"
                />
              </label>

              <div role="radiogroup" aria-label="La mercadería" className="grid grid-cols-2 gap-2">
                {[
                  { valor: true, texto: "Volvió", tecla: "Alt + V" },
                  { valor: false, texto: "Se la llevó", tecla: "Alt + L" },
                ].map((o) => (
                  <button
                    key={o.texto}
                    type="button"
                    role="radio"
                    aria-checked={volvio === o.valor}
                    onClick={() => {
                      setVolvio(o.valor);
                      setPidePin(null);
                    }}
                    className={`inline-flex h-12 items-center justify-center gap-2 rounded-xl border text-base font-semibold transition-colors ${
                      volvio === o.valor ? "border-accion bg-accion text-white" : "border-linea hover:bg-hundida"
                    }`}
                  >
                    {o.texto}
                    <kbd className="rounded border border-current/40 px-1 text-xs font-medium opacity-70">{o.tecla}</kbd>
                  </button>
                ))}
              </div>

              {pidePin ? (
                <CampoPin
                  autorizacion={pidePin}
                  enviando={trabajando}
                  onEnviar={(pin) => anular(pin)}
                  onCancelar={() => setPidePin(null)}
                />
              ) : (
                <button
                  disabled={trabajando || !motivo.trim()}
                  onClick={() => anular()}
                  className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-accion text-lg font-bold text-white transition-colors hover:bg-accion-hover disabled:opacity-40"
                >
                  <Undo2 className="h-5 w-5" />
                  Anular la venta
                </button>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
