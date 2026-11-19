"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatearMonto } from "@/lib/formato";
import { importeDeCaja, nombreDeLaDiferencia, TOLERANCIA_ARQUEO } from "@/lib/mostrador/arqueo";
import { encolarMovimiento } from "@/lib/mostrador/offline/cola";
import type { RenglonDelCierre } from "@/lib/mostrador/tipos";
import { abrirCaja, cerrarCaja, registrarMovimientoDeCaja } from "./actions";
import { NOMBRE_DEL_MEDIO } from "./medios";
import type { Sucursal, Turno, Movimiento, VentaDeHoy } from "./tipos";
import { VentasDeHoy } from "./ventas-de-hoy";

export function PanelDeCaja({
  sucursal,
  turno,
  fondoBase,
  cierre,
  movimientos,
  ventas,
  enLinea,
  onEncolado,
  onAbierta,
  focoAlCerrar,
  onCerrar,
}: {
  sucursal: Sucursal;
  turno: Turno | null;
  /**
   * El cambio de la sucursal, para poder decirlo **antes** de abrir la caja:
   * con el turno cerrado no hay de dónde leerlo.
   */
  fondoBase: number;
  cierre: RenglonDelCierre[];
  movimientos: Movimiento[];
  ventas: VentaDeHoy[];
  enLinea: boolean;
  onEncolado: () => void;
  /** Se abrió el turno, con el mensaje de Go. */
  onAbierta?: (mensaje: string) => void;
  /** A dónde vuelve el cursor al cerrar el panel. */
  focoAlCerrar?: () => HTMLElement | null;
  onCerrar: () => void;
}) {
  const router = useRouter();
  const [trabajando, empezar] = useTransition();
  const [fondo, setFondo] = useState("");
  const [contado, setContado] = useState("");
  const [notas, setNotas] = useState("");
  const [monto, setMonto] = useState("");
  const [motivo, setMotivo] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);

  const efectivoContado = importeDeCaja(contado);
  const diferencia =
    turno && efectivoContado !== null ? efectivoContado - turno.esperado : null;
  const importeDelMovimiento = importeDeCaja(monto);

  function abrir() {
    const importe = importeDeCaja(fondo);
    if (trabajando || importe === null || !enLinea) return;
    empezar(async () => {
      const r = await abrirCaja(sucursal.id, importe);
      setAviso(r.error ?? r.ok ?? null);
      if (!r.error) {
        setFondo("");
        router.refresh();
        onAbierta?.(r.ok ?? "Caja abierta.");
      }
    });
  }

  // Antes de abrir no hay turno, así que la base sale de la sucursal.
  const baseDeCambio = turno?.fondoBase ?? fondoBase;

  return (
    /*
     * El diálogo del sistema y no un `div` fijo propio. No es cosmético: este
     * trae el foco atrapado adentro, cierra con Escape y devuelve el foco al
     * botón que lo abrió. Armado a mano, el teclado seguía llegando a la venta
     * de atrás —el fondo inicial terminaba escrito en el campo del cobro—.
     */
    <Dialog open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent
        finalFocus={focoAlCerrar}
        className="flex max-h-[calc(100vh-3rem)] w-full flex-col overflow-hidden p-0 sm:max-w-2xl"
      >
        {/* `mx-0 mt-0` no es redundante: `DialogHeader` trae márgenes negativos
            para desbordar el `p-5` que el diálogo tiene de fábrica, y este
            diálogo lo anula con `p-0` porque su cuerpo scrollea aparte. Sin
            esto, el encabezado se salía veinte píxeles por cada lado y el
            título quedaba cortado contra el borde del panel. */}
        <DialogHeader className="mx-0 mt-0 border-b border-linea px-5 py-3.5">
          <DialogTitle className="text-xl font-bold tracking-tight">
            Caja · {sucursal.nombre}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {aviso && (
            <p className="mb-4 rounded-xl bg-hundida p-3.5 text-base">{aviso}</p>
          )}

          {!turno ? (
            <div>
              <p className="text-base text-muted-foreground">
                {/* Se abre con el efectivo con el que se arranca el día. */}
                No hay caja abierta en esta sucursal.
                {baseDeCambio > 0 && (
                  <>
                    {" "}
                    El cambio que tiene que quedar siempre acá es{" "}
                    <strong className="tabular text-foreground">
                      {formatearMonto(baseDeCambio)}
                    </strong>
                    .
                  </>
                )}
              </p>
              <label className="mt-4 block">
                <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Fondo inicial
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  // Se abre para cargar el fondo: el cursor arranca acá.
                  autoFocus
                  value={fondo}
                  onChange={(e) => setFondo(e.target.value)}
                  onKeyDown={(e) => {
                    // Es el único dato: Enter (o Ctrl+Enter) abre la caja.
                    if (e.key === "Enter") {
                      e.preventDefault();
                      abrir();
                    }
                  }}
                  className="tabular mt-1.5 h-14 w-full rounded-xl border border-linea bg-background px-3.5 text-right text-2xl font-semibold"
                />
              </label>
              <button
                disabled={trabajando || importeDeCaja(fondo) === null || !enLinea}
                onClick={abrir}
                className="mt-4 inline-flex h-14 w-full items-center justify-center rounded-xl bg-accion text-lg font-bold text-white transition-colors hover:bg-accion-hover disabled:opacity-40"
              >
                Abrir la caja
              </button>
              {/* Abrir y cerrar caja son en línea, y no por comodidad: el
                  índice único que garantiza un turno por sucursal vive en la
                  base. Dos máquinas abriendo sin conexión terminarían con dos
                  turnos y las ventas del día repartidas entre los dos. */}
              {!enLinea && (
                // Las ventas sin conexión entran al turno cuando vuelve.
                <p className="mt-2 text-sm text-muted-foreground">
                  Sin conexión no se puede abrir la caja; sí se puede seguir vendiendo.
                </p>
              )}
            </div>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-3">
                <Dato titulo="Fondo inicial" valor={turno.fondoInicial} />
                <Dato titulo="Ventas en efectivo" valor={turno.ventasEnEfectivo} />
                <Dato titulo="Otros ingresos" valor={turno.otrosIngresos} />
                <Dato titulo="Retiros" valor={turno.retiros} />
              </dl>

              <div className="tarjeta-hundida mt-3 flex items-baseline justify-between rounded-xl p-4">
                <span className="text-lg font-semibold">Debería haber</span>
                <span className="tabular text-3xl font-bold">
                  {formatearMonto(turno.esperado)}
                </span>
              </div>

              {/* El cambio que no se retira. Sin esto, «podés retirar hasta
                  tanto» aparecía recién como error al intentarlo. */}
              {turno.fondoBase > 0 && (
                <p className="mt-2 flex items-baseline justify-between text-base text-muted-foreground">
                  <span>Cambio que queda para mañana</span>
                  <span className="tabular font-semibold">
                    {formatearMonto(turno.fondoBase)}
                  </span>
                </p>
              )}

              {/* El cierre Z. Lo de arriba es el efectivo, que es lo único que
                  puede faltar del cajón; esto es todo lo que se cobró en el
                  turno, que es lo que hay que conciliar contra el posnet y el
                  banco. */}
              {cierre.length > 0 && (
                <section className="mt-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Cobrado en el turno
                  </h3>
                  <dl className="mt-2 divide-y divide-linea-tenue rounded-xl border border-linea">
                    {cierre.map((r) => (
                      <div
                        key={`${r.devolucion ? "dev-" : ""}${r.medioPago}-${r.quien ?? ""}`}
                        className="flex items-baseline justify-between gap-3 px-4 py-2.5"
                      >
                        <dt className="text-base">
                          {r.devolucion && "Devolución · "}
                          {NOMBRE_DEL_MEDIO[r.medioPago] ?? r.medioPago}
                          {r.quien && ` · ${r.quien}`}
                          <span className="ml-1.5 text-sm text-muted-foreground">
                            ({r.cantidad})
                          </span>
                        </dt>
                        <dd className="tabular font-semibold">
                          {formatearMonto(r.total)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}

              <section className="mt-6">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Ingreso o retiro
                </h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={monto}
                    onChange={(e) => setMonto(e.target.value)}
                    placeholder="Monto"
                    className="tabular h-12 w-32 rounded-lg border border-linea bg-background px-3 text-right text-base"
                  />
                  <input
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    placeholder="Motivo"
                    className="h-12 min-w-0 flex-1 rounded-lg border border-linea bg-background px-3 text-base"
                  />
                  {(["ingreso", "retiro"] as const).map((t) => (
                    <button
                      key={t}
                      disabled={trabajando || !(importeDelMovimiento !== null && importeDelMovimiento > 0) || !motivo.trim()}
                      onClick={() =>
                        empezar(async () => {
                          if (importeDelMovimiento === null) return;
                          /*
                           * Sin conexión el movimiento se encola en vez de
                           * perderse. La plata sale del cajón en el momento,
                           * no cuando vuelve el wifi: si el retiro no queda
                           * anotado, el arqueo de la noche muestra un faltante
                           * que nadie va a poder explicar.
                           */
                          /*
                           * El piso de cambio también sin conexión.
                           *
                           * El servidor lo controla al registrar el retiro,
                           * pero sin conexión no hay servidor: acá la cuenta se
                           * hace con el esperado que ya está en pantalla. Sin
                           * esto, la regla que la clienta pidió se caía justo
                           * el día que se corta internet.
                           */
                          if (
                            t === "retiro" &&
                            turno.fondoBase > 0 &&
                            turno.esperado - importeDelMovimiento < turno.fondoBase
                          ) {
                            const disponible = Math.max(
                              0,
                              turno.esperado - turno.fondoBase,
                            );
                            setAviso(
                              disponible > 0
                                ? `Ese retiro deja el cajón sin el cambio de la base (${formatearMonto(turno.fondoBase)}). Podés retirar hasta ${formatearMonto(disponible)}.`
                                : `No se puede retirar: en el cajón hay ${formatearMonto(turno.esperado)} y la base de cambio es ${formatearMonto(turno.fondoBase)}.`,
                            );
                            return;
                          }

                          if (!enLinea) {
                            await encolarMovimiento({
                              clave: crypto.randomUUID(),
                              branchId: sucursal.id,
                              tipo: t,
                              monto: importeDelMovimiento,
                              motivo: motivo.trim(),
                              hechoAt: new Date().toISOString(),
                            });
                            setAviso(
                              `${t === "retiro" ? "Retiro" : "Ingreso"} anotado. Se sube cuando vuelva la conexión.`,
                            );
                            setMonto("");
                            setMotivo("");
                            onEncolado();
                            return;
                          }

                          const r = await registrarMovimientoDeCaja(
                            turno.id,
                            t,
                            importeDelMovimiento,
                            motivo,
                          );
                          setAviso(r.error ?? r.ok ?? null);
                          if (!r.error) {
                            setMonto("");
                            setMotivo("");
                            router.refresh();
                          }
                        })
                      }
                      className="h-12 rounded-lg border border-linea px-4 text-base font-medium transition-colors hover:bg-hundida disabled:opacity-40"
                    >
                      {t === "ingreso" ? "Ingreso" : "Retiro"}
                    </button>
                  ))}
                </div>
              </section>

              <section className="mt-6">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Cerrar el turno
                </h3>
                <label className="mt-2 block">
                  <span className="text-base text-muted-foreground">
                    Contá el efectivo y poné cuánto hay
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={contado}
                    onChange={(e) => setContado(e.target.value)}
                    className="tabular mt-1.5 h-14 w-full rounded-xl border border-linea bg-background px-3.5 text-right text-2xl font-semibold"
                  />
                </label>

                {/* Faltante o sobrante, con esa palabra: un número con signo
                    obliga a traducir, y es el dato que después hay que
                    explicar. */}
                {diferencia !== null && (
                  <p className="mt-2 flex items-baseline justify-between text-lg">
                    <span className="text-muted-foreground">
                      {nombreDeLaDiferencia(diferencia) === "sin diferencia"
                        ? "Arqueo"
                        : nombreDeLaDiferencia(diferencia) === "faltante"
                          ? "Falta"
                          : "Sobra"}
                    </span>
                    <span
                      className={`tabular font-bold ${
                        Math.abs(diferencia) <= TOLERANCIA_ARQUEO
                          ? "text-saldo-cero"
                          : diferencia < 0
                            ? "text-saldo-debe"
                            : "text-saldo-favor"
                      }`}
                    >
                      {Math.abs(diferencia) <= TOLERANCIA_ARQUEO
                        ? "cierra"
                        : formatearMonto(Math.abs(diferencia))}
                    </span>
                  </p>
                )}

                {diferencia !== null &&
                  Math.abs(diferencia) > TOLERANCIA_ARQUEO && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Escribí qué pasó: no se puede cerrar con una diferencia
                      sin explicar.
                    </p>
                  )}

                {turno.fondoBase > 0 &&
                  contado !== "" &&
                  efectivoContado !== null &&
                  efectivoContado < turno.fondoBase && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Quedan menos de {formatearMonto(turno.fondoBase)}: mañana
                      el mostrador arranca sin cambio.
                    </p>
                  )}

                <input
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                  placeholder={
                    diferencia !== null &&
                    Math.abs(diferencia) > TOLERANCIA_ARQUEO
                      ? "Qué pasó con la diferencia"
                      : "Notas del cierre (opcional)"
                  }
                  className="mt-2.5 h-12 w-full rounded-lg border border-linea bg-background px-3 text-base"
                />

                <button
                  disabled={trabajando || efectivoContado === null || !enLinea}
                  onClick={() =>
                    empezar(async () => {
                      if (efectivoContado === null) return;
                      const r = await cerrarCaja(turno.id, efectivoContado, notas);
                      setAviso(r.error ?? r.ok ?? null);
                      if (!r.error) {
                        setContado("");
                        setNotas("");
                        router.refresh();
                      }
                    })
                  }
                  className="mt-3.5 inline-flex h-14 w-full items-center justify-center gap-2 rounded-xl border border-linea text-lg font-bold transition-colors hover:bg-hundida disabled:opacity-40"
                >
                  <Lock className="h-5 w-5" />
                  Cerrar el turno
                </button>
                {!enLinea && (
                  // Además faltaría contar las ventas que todavía no subieron:
                  // esa plata está en el cajón pero no en el turno.
                  <p className="mt-2 text-sm text-muted-foreground">
                    Sin conexión no se puede cerrar.
                  </p>
                )}
              </section>

              {movimientos.length > 0 && (
                <section className="mt-6">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Movimientos
                  </h3>
                  <ul className="mt-2 divide-y divide-linea">
                    {movimientos.map((m) => (
                      <li key={m.id} className="flex items-center gap-3 py-2.5">
                        <span className="min-w-0 flex-1 truncate text-base">
                          {m.motivo ?? m.tipo}
                        </span>
                        <span
                          className={`tabular shrink-0 font-semibold ${
                            m.monto < 0 ? "text-saldo-debe" : "text-saldo-favor"
                          }`}
                        >
                          {formatearMonto(m.monto)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}

          {/* Fuera de la rama del turno a propósito: con débito o transferencia
              se vende sin abrir caja, y si no se pudiera deshacer eso, la mitad
              de las ventas del día quedarían sin arreglo posible. */}
          <VentasDeHoy ventas={ventas} />
        </div>
      </DialogContent>
    </Dialog>
  );
}


export function Dato({ titulo, valor }: { titulo: string; valor: number }) {
  return (
    <div className="rounded-xl border border-linea p-3.5">
      <dt className="text-sm text-muted-foreground">{titulo}</dt>
      <dd className="tabular mt-0.5 text-xl font-semibold">
        {formatearMonto(valor)}
      </dd>
    </div>
  );
}
