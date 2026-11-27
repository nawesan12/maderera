"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, PackageMinus, PackagePlus, Printer, RotateCcw, Undo2 } from "lucide-react";
import { Devolucion } from "@/app/admin/facturacion/[id]/devolucion";
import type { DatosDeDevolucion } from "@/lib/dal/admin/facturacion";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CampoPin, type Autorizacion } from "@/components/autorizacion/campo-pin";
import { formatearImporte, hora } from "@/lib/formato";
import { formatearCantidad } from "@/lib/unidades";
import type { LineaDeVenta, PagoDeVenta } from "@/lib/mostrador/importes";
import {
  anularVenta,
  calcularDevolucionDeVenta,
  datosDeDevolucionDeVenta,
  datosDeDevolucionSinFactura,
  devolverDeVenta,
  devolverSinFactura,
} from "./actions";
import { NOMBRE_DEL_MEDIO } from "./medios";
import type { VentaDeHoy } from "./tipos";

/** Lo que vuelve con «Rehacer» además de los renglones. */
export interface DatosParaRehacer {
  customerId: string | null;
  comprobante: "interno" | "fiscal" | null;
  pagos: PagoDeVenta[];
  cortes: string[];
}

type DatosSinFactura = NonNullable<Awaited<ReturnType<typeof datosDeDevolucionSinFactura>>["datos"]>;

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
   * el stock salía dos veces (mes simulado, H269). Vuelven también el
   * cliente, el papel, cómo pagó y el corte de la cola (M2S1-178, M2S2-133,
   * M2S3-047).
   */
  onRehacer?: (renglones: LineaDeVenta[], conCorte: boolean, venta: VentaDeHoy, datos?: DatosParaRehacer) => void;
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
  /** La de una venta sin factura (M3S2-060): stock y plata, sin nota. */
  const [sinFactura, setSinFactura] = useState<{ venta: VentaDeHoy; datos: DatosSinFactura } | null>(null);

  function abrirDevolucion(v: VentaDeHoy) {
    empezar(async () => {
      if (!v.conFactura) {
        const r = await datosDeDevolucionSinFactura(v.id);
        if ("error" in r || !r.datos) {
          setAviso(("error" in r && r.error) || "No se pudo abrir la devolución.");
          return;
        }
        setSinFactura({ venta: v, datos: r.datos });
        return;
      }
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
      const r = await anularVenta(venta.id, motivo, { volvioLaMercaderia: rehacer ? true : volvio, pin, rehacer });
      if (r.autorizacion) {
        setPidePin(r.autorizacion);
        return;
      }
      setPidePin(null);
      setAviso(r.error ?? [r.ok, r.avisoFiscal].filter(Boolean).join(" "));
      if (!r.error) {
        setAnulando(null);
        router.refresh();
        if (rehacer && r.renglones) onRehacer?.(r.renglones, Boolean(r.conCorte), venta, r.rehacer);
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

              {/* Con una devolución, el total original tachado y abajo lo
                  que quedó: «$ 114.048 · −$ 57.024 devuelto» se leía como si
                  hubiera que restar otra vez (mes simulado, M2S4-063). Una
                  columna de ancho fijo: con y sin íconos, los importes
                  quedaban en zigzag (M2S1-181). */}
              <span className="w-32 shrink-0 text-right">
                {devuelto > 0 && !anulada && (
                  <span className="tabular block text-sm text-muted-foreground line-through">{formatearImporte(v.total)}</span>
                )}
                <span
                  className={`tabular block font-semibold ${anulada ? "text-muted-foreground line-through" : ""}`}
                >
                  {formatearImporte(devuelto > 0 && !anulada ? v.total - devuelto : v.total)}
                </span>
              </span>

              {/* Los íconos en su lugar fijo, aunque falte alguno. */}
              <span className="flex w-[9.5rem] shrink-0 items-center justify-end">
                <Link
                  href={`/ticket/${v.id}`}
                  target="_blank"
                  aria-label={`Imprimir ${v.numero}`}
                  className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-hundida hover:text-foreground"
                >
                  <Printer className="h-4 w-4" />
                </Link>

                {!anulada ? (
                  <>
                    {/* Una parte, con o sin factura (M3S2-060). */}
                    <button
                      onClick={() => abrirDevolucion(v)}
                      disabled={trabajando}
                      aria-label={`Devolver una parte de ${v.numero}`}
                      title="Devolver una parte"
                      className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-hundida hover:text-foreground"
                    >
                      <PackageMinus className="h-4 w-4" />
                    </button>
                    {/* Lo que le faltó al cliente se repone sin cargo, atado a
                        la venta: el único camino era el Stock (M3S3-021). */}
                    <Link
                      href={`/admin/pedidos/${v.id}?falto=1`}
                      target="_blank"
                      aria-label={`Le faltó algo de ${v.numero}`}
                      title="Le faltó algo"
                      className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-hundida hover:text-foreground"
                    >
                      <PackagePlus className="h-4 w-4" />
                    </Link>
                    <button
                      onClick={() => {
                        setAnulando(v);
                        setMotivo("");
                        setVolvio(true);
                        setPidePin(null);
                        setRehaciendo(false);
                      }}
                      aria-label={`Anular ${v.numero}`}
                      className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-hundida hover:text-foreground"
                    >
                      <Undo2 className="h-4 w-4" />
                    </button>
                  </>
                ) : (
                  <span className="w-24" aria-hidden="true" />
                )}
              </span>
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

      {sinFactura && (
        <DevolucionSinFactura
          venta={sinFactura.venta}
          datos={sinFactura.datos}
          onCerrar={() => setSinFactura(null)}
          onHecha={(mensaje) => {
            setSinFactura(null);
            setAviso(mensaje);
            router.refresh();
          }}
        />
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

/**
 * La devolución de una parte de una venta sin factura (mes simulado,
 * M3S2-060): cuánto de cada renglón y por dónde vuelve la plata —en efectivo
 * de la caja, hasta lo cobrado en efectivo, o por el medio con que pagó—. Al
 * vendedor le pide el PIN, como la de factura.
 */
function DevolucionSinFactura({
  venta,
  datos,
  onCerrar,
  onHecha,
}: {
  venta: VentaDeHoy;
  datos: DatosSinFactura;
  onCerrar: () => void;
  onHecha: (mensaje: string) => void;
}) {
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [motivo, setMotivo] = useState("");
  // Sin nada cobrado (fue a cuenta corriente), vuelve a la cuenta.
  const aCuenta = datos.efectivo <= 0.005 && datos.afuera <= 0.005;
  const [destino, setDestino] = useState<"caja" | "afuera" | "cuenta">(
    aCuenta ? "cuenta" : datos.efectivo > 0.005 ? "caja" : "afuera",
  );
  const [clave] = useState(() => crypto.randomUUID());
  const [pidePin, setPidePin] = useState<Autorizacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enCurso, empezar] = useTransition();

  const leer = (t: string | undefined) => {
    const n = Number((t ?? "").trim().replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const renglones = datos.renglones
    .map((r) => ({ orderItemId: r.orderItemId, cantidad: Math.min(leer(cantidades[r.orderItemId]), r.cantidad - r.devuelto) }))
    .filter((r) => r.cantidad > 0);
  const importe = datos.renglones.reduce(
    (s, r) => s + Math.round(Math.min(leer(cantidades[r.orderItemId]), r.cantidad - r.devuelto) * r.precioUnitario * 100) / 100,
    0,
  );
  const tope = destino === "caja" ? datos.efectivo : destino === "afuera" ? datos.afuera : Number.POSITIVE_INFINITY;
  const puede = renglones.length > 0 && motivo.trim() !== "" && importe <= tope + 0.005 && !enCurso;

  function devolver(pin?: string) {
    if (!puede && !pin) return;
    setError(null);
    empezar(async () => {
      const r = await devolverSinFactura(venta.id, { clave, destino, motivo, renglones }, pin);
      if (r.autorizacion) {
        setPidePin(r.autorizacion);
        return;
      }
      if (r.error) {
        setError(r.error);
        return;
      }
      onHecha(r.ok ?? "Devolución registrada.");
    });
  }

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold tracking-tight">Devolución · {datos.numero}</DialogTitle>
        </DialogHeader>
        <ul className="divide-y divide-linea">
          {datos.renglones.map((r, i) => {
            const queda = Math.max(0, r.cantidad - r.devuelto);
            return (
              <li key={r.orderItemId} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-base">{r.descripcion}</span>
                  <span className="tabular block text-sm text-muted-foreground">
                    {formatearCantidad(queda)} de {formatearCantidad(r.cantidad)}
                  </span>
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  autoFocus={i === 0}
                  disabled={queda <= 0}
                  value={cantidades[r.orderItemId] ?? ""}
                  onChange={(e) => setCantidades({ ...cantidades, [r.orderItemId]: e.target.value })}
                  aria-label={`Cuánto devuelve de ${r.descripcion}`}
                  placeholder="0"
                  className="tabular h-11 w-20 shrink-0 rounded-lg border border-linea bg-background px-2.5 text-right text-base disabled:opacity-40"
                />
              </li>
            );
          })}
        </ul>
        {!aCuenta && (
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="La plata">
          {(
            [
              ["caja", "En efectivo", datos.efectivo],
              ["afuera", "Por el medio de pago", datos.afuera],
            ] as const
          ).map(([valor, texto, max]) => (
            <button
              key={valor}
              type="button"
              aria-pressed={destino === valor}
              disabled={max <= 0.005}
              onClick={() => setDestino(valor)}
              className={`h-12 rounded-xl border text-base font-medium transition-colors disabled:opacity-40 ${
                destino === valor ? "border-accion bg-accion text-white" : "border-linea hover:bg-hundida"
              }`}
            >
              {texto}
            </button>
          ))}
        </div>
        )}
        <input

          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              devolver();
            }
          }}
          placeholder="Por qué"
          aria-label="Por qué devuelve"
          className="h-12 w-full rounded-lg border border-linea bg-background px-3 text-base"
        />
        {error && (
          <p role="alert" className="estado-problema rounded-lg bg-[var(--estado-fondo)] px-3.5 py-2.5 text-base">
            {error}
          </p>
        )}
        {pidePin ? (
          <CampoPin autorizacion={pidePin} enviando={enCurso} onEnviar={(pin) => devolver(pin)} onCancelar={() => setPidePin(null)} />
        ) : (
          <button
            type="button"
            disabled={!puede}
            onClick={() => devolver()}
            className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-accion text-lg font-bold text-white transition-colors hover:bg-accion-hover disabled:opacity-40"
          >
            {enCurso && <Loader2 className="h-5 w-5 animate-spin" />}
            Devolver {importe > 0 ? formatearImporte(importe) : ""}
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}
