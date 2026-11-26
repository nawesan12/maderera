"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PackageMinus, Printer, RotateCcw, Undo2 } from "lucide-react";
import { Devolucion } from "@/app/admin/facturacion/[id]/devolucion";
import type { DatosDeDevolucion } from "@/lib/dal/admin/facturacion";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CampoPin, type Autorizacion } from "@/components/autorizacion/campo-pin";
import { formatearImporte, hora } from "@/lib/formato";
import type { LineaDeVenta } from "@/lib/mostrador/importes";
import { anularVenta, calcularDevolucionDeVenta, datosDeDevolucionDeVenta, devolverDeVenta } from "./actions";
import { NOMBRE_DEL_MEDIO } from "./medios";
import type { VentaDeHoy } from "./tipos";

/**
 * Las ventas de hoy, con la posibilidad de deshacerlas.
 *
 * El mostrador no tiene historial: tiene "lo que pasó hoy". Las anuladas van
 * tachadas y no escondidas, porque esconderlas hace que el mismo error se anule
 * dos veces.
 */
export function VentasDeHoy({
  ventas,
  onRehacer,
}: {
  ventas: VentaDeHoy[];
  /**
   * «Anular y rehacer»: la venta se anula con la mercadería de vuelta y sus
   * renglones quedan cargados para cobrarla de nuevo, por ejemplo a otro
   * cliente. Antes había que anular con «Se la llevó» y volver a venderla, y
   * el stock salía dos veces (mes simulado, H269).
   */
  onRehacer?: (renglones: LineaDeVenta[], conCorte: boolean, venta: VentaDeHoy) => void;
}) {
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
  /*
   * Devolver una parte de una venta con factura (mes simulado, H270): antes
   * había que anular la venta entera, devolver todo a la tarjeta y cobrar de
   * nuevo lo que se quedaba. Es la devolución del panel, por la venta.
   */
  const [devolviendo, setDevolviendo] = useState<{ venta: VentaDeHoy; datos: DatosDeDevolucion } | null>(null);

  function abrirDevolucion(v: VentaDeHoy) {
    empezar(async () => {
      const r = await datosDeDevolucionDeVenta(v.id);
      if (r.error || !r.datos) {
        setAviso(r.error ?? "No se pudo abrir la devolución.");
        return;
      }
      setDevolviendo({ venta: v, datos: r.datos });
    });
  }
  /** Se está anulando para rehacer: lo recuerda mientras se pide el PIN. */
  const [rehaciendo, setRehaciendo] = useState(false);

  function anular(pin?: string, rehacer = rehaciendo) {
    if (!anulando || !motivo.trim()) return;
    const venta = anulando;
    setRehaciendo(rehacer);
    empezar(async () => {
      // Rehacer es anular con la mercadería de vuelta: sale otra vez con la
      // venta nueva, y así el stock baja una sola vez.
      const r = await anularVenta(venta.id, motivo, { volvioLaMercaderia: rehacer ? true : volvio, pin });
      if (r.autorizacion) {
        setPidePin(r.autorizacion);
        return;
      }
      setPidePin(null);
      setAviso(r.error ?? [r.ok, r.avisoFiscal].filter(Boolean).join(" "));
      if (!r.error) {
        setAnulando(null);
        router.refresh();
        if (rehacer && r.renglones) onRehacer?.(r.renglones, Boolean(r.conCorte), venta);
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
          const devuelto = v.devuelto ?? 0;
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
                  {/* Todos los medios de un pago partido, no solo el
                      principal (H025). */}
                  {(v.medios?.length ?? 0) > 1
                    ? ` · ${v.medios!.map((m) => NOMBRE_DEL_MEDIO[m] ?? m).join(" + ")}`
                    : v.medioPago
                      ? ` · ${NOMBRE_DEL_MEDIO[v.medioPago] ?? v.medioPago}`
                      : ""}
                </span>
              </span>

              {/* Con una devolución parcial vale lo que quedó, y abajo, lo
                  devuelto: el total original solo no decía nada (PED-1202). */}
              <span className="shrink-0 text-right">
                <span
                  className={`tabular block font-semibold ${anulada ? "text-muted-foreground line-through" : ""}`}
                >
                  {formatearImporte(devuelto > 0 && !anulada ? v.total - devuelto : v.total)}
                </span>
                {devuelto > 0 && !anulada && (
                  <span className="tabular estado-espera block text-sm text-[var(--estado-tinta)]">
                    −{formatearImporte(devuelto)} devuelto
                  </span>
                )}
              </span>

              <Link
                href={`/ticket/${v.id}`}
                target="_blank"
                aria-label={`Imprimir ${v.numero}`}
                className="shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-hundida hover:text-foreground"
              >
                <Printer className="h-4 w-4" />
              </Link>

              {!anulada && v.conFactura && (
                <button
                  onClick={() => abrirDevolucion(v)}
                  disabled={trabajando}
                  aria-label={`Devolver una parte de ${v.numero}`}
                  title="Devolver una parte"
                  className="shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-hundida hover:text-foreground"
                >
                  <PackageMinus className="h-4 w-4" />
                </button>
              )}

              {!anulada && (
                <button
                  onClick={() => {
                    setAnulando(v);
                    setMotivo("");
                    setVolvio(true);
                    setPidePin(null);
                    setRehaciendo(false);
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

      {devolviendo && (
        <Dialog open onOpenChange={(abierto) => !abierto && setDevolviendo(null)}>
          <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-xl font-bold tracking-tight">Devolución · {devolviendo.venta.numero}</DialogTitle>
            </DialogHeader>
            <Devolucion
              invoiceId=""
              conTitulo={false}
              datos={devolviendo.datos}
              alCancelar={() => setDevolviendo(null)}
              acciones={{
                calcular: (renglones) => calcularDevolucionDeVenta(devolviendo.venta.id, renglones),
                devolver: (pedido, pin) => devolverDeVenta(devolviendo.venta.id, pedido, pin),
              }}
              alTerminar={(mensaje) => {
                setDevolviendo(null);
                setAviso(mensaje);
                router.refresh();
              }}
            />
          </DialogContent>
        </Dialog>
      )}

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
                if (e.code === "KeyR" && onRehacer && !pidePin) {
                  e.preventDefault();
                  anular(undefined, true);
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
                <div className="flex gap-2">
                  <button
                    disabled={trabajando || !motivo.trim()}
                    onClick={() => anular(undefined, false)}
                    className="inline-flex h-14 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-accion text-lg font-bold text-white transition-colors hover:bg-accion-hover disabled:opacity-40"
                  >
                    <Undo2 className="h-5 w-5" />
                    Anular la venta
                  </button>
                  {/* Para cambiarle el cliente o corregir un renglón: la
                      mercadería no vuelve al estante, sale con la nueva. */}
                  {onRehacer && (
                    <button
                      type="button"
                      disabled={trabajando || !motivo.trim()}
                      onClick={() => anular(undefined, true)}
                      className="inline-flex h-14 shrink-0 items-center justify-center gap-2 rounded-xl border border-linea px-4 text-base font-semibold transition-colors hover:bg-hundida disabled:opacity-40"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Rehacer
                      <kbd className="rounded border border-current/40 px-1 text-xs font-medium opacity-70">Alt + R</kbd>
                    </button>
                  )}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
