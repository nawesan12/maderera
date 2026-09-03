"use client";

import { useState, useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import { formatearMonto } from "@/lib/formato";
import { asignarVentaAlTurno, type EstadoCajas } from "./actions";

interface VentaSuelta {
  id: string;
  numero: string;
  numeroProvisorio: string | null;
  branchId: string;
  sucursal: string | null;
  cliente: string;
  total: string;
  cobradaAt: Date | null;
}

interface TurnoElegible {
  id: string;
  branchId: string;
  etiqueta: string;
}

/**
 * Las ventas en efectivo que no cayeron en ningún turno.
 *
 * Pasa cuando el mostrador cobró sin conexión y no había ninguna caja abierta.
 * La venta se guardó igual —rechazarla habría sido perder plata ya cobrada y
 * mercadería ya entregada— y lo que queda es decir en qué cajón quedó ese
 * efectivo. Eso no se puede adivinar: lo sabe quien estaba ahí.
 *
 * La sección solo aparece cuando hay algo. Un cartel permanente diciendo "0
 * ventas sueltas" es ruido, y el ruido es lo que hace que después nadie mire.
 */
export function VentasSueltas({
  ventas,
  turnos,
}: {
  ventas: VentaSuelta[];
  turnos: TurnoElegible[];
}) {
  const [estado, setEstado] = useState<EstadoCajas>({});
  const [enCurso, empezar] = useTransition();

  if (ventas.length === 0) return null;

  return (
    <section className="tarjeta overflow-hidden border-[var(--estado-borde)]">
      <header className="estado-problema flex items-center gap-2.5 border-b border-linea bg-[var(--estado-fondo)] px-5 py-3.5">
        <AlertTriangle className="h-4.5 w-4.5 shrink-0" />
        <div>
          <h2 className="text-base font-semibold">
            {ventas.length} venta{ventas.length > 1 ? "s" : ""} en efectivo sin
            turno
          </h2>
          <p className="text-sm">
            Se cobraron sin conexión con la caja cerrada. La plata está en el
            cajón; falta decir en cuál.
          </p>
        </div>
      </header>

      {(estado.error || estado.ok) && (
        <p
          className={`px-5 py-2.5 text-sm ${estado.error ? "text-saldo-debe" : "text-saldo-favor"}`}
        >
          {estado.error ?? estado.ok}
        </p>
      )}

      <ul className="divide-y divide-linea">
        {ventas.map((v) => {
          const suyos = turnos.filter((t) => t.branchId === v.branchId);

          return (
            <li key={v.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold">
                  {v.numero}
                  {v.numeroProvisorio && (
                    <span className="ml-2 font-normal text-muted-foreground">
                      ref. {v.numeroProvisorio}
                    </span>
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  {v.cliente} · {v.sucursal ?? "—"} ·{" "}
                  {v.cobradaAt
                    ? new Date(v.cobradaAt).toLocaleString("es-AR", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })
                    : "sin hora"}
                </p>
              </div>

              <span className="tabular shrink-0 text-base font-semibold">
                {formatearMonto(Number(v.total))}
              </span>

              {suyos.length === 0 ? (
                <span className="text-sm text-muted-foreground">
                  Esa sucursal no tiene ningún turno donde ponerla.
                </span>
              ) : (
                <select
                  defaultValue=""
                  disabled={enCurso}
                  onChange={(e) => {
                    const sessionId = e.target.value;
                    if (!sessionId) return;
                    empezar(async () =>
                      setEstado(await asignarVentaAlTurno(v.id, sessionId)),
                    );
                  }}
                  className="h-10 shrink-0 rounded-lg border border-linea bg-card px-3 text-sm"
                >
                  <option value="">Asignar a un turno…</option>
                  {suyos.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.etiqueta}
                    </option>
                  ))}
                </select>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
