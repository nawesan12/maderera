"use client";

import { useState, useTransition } from "react";
import { fechaHoraODia, formatearImporte } from "@/lib/formato";
import { asignarReciboAlTurno, type EstadoCajas } from "./actions";

interface Renglon {
  tipo: "recibo" | "gasto" | "pago";
  id: string;
  detalle: string;
  sucursal: string | null;
  branchId: string | null;
  monto: number;
  fecha: Date;
}

/**
 * El efectivo que no pasó por ningún turno: el asiento mueve la cuenta Caja,
 * pero ningún arqueo lo cuenta (mes simulado, H157). El recibo se manda a un
 * turno de su sucursal, como la venta suelta: sin eso la lista solo crecía
 * (M3S1-013).
 */
export function FueraDeCaja({
  renglones,
  turnos,
}: {
  renglones: Renglon[];
  turnos: { id: string; branchId: string; etiqueta: string }[];
}) {
  const [estado, setEstado] = useState<EstadoCajas>({});
  const [enCurso, empezar] = useTransition();
  if (renglones.length === 0) return null;

  return (
    <section className="tarjeta-atencion overflow-hidden">
      <header className="flex items-baseline justify-between gap-3 px-5 py-3.5">
        <h2 className="text-base font-semibold">Efectivo fuera de caja</h2>
        <span className="tabular text-base font-semibold">
          {formatearImporte(renglones.reduce((s, f) => s + f.monto, 0))}
        </span>
      </header>
      {(estado.error || estado.ok) && (
        <p className={`px-5 pb-2 text-sm ${estado.error ? "text-saldo-debe" : "text-saldo-favor"}`}>{estado.error ?? estado.ok}</p>
      )}
      <ul className="divide-y divide-linea">
        {renglones.map((f) => {
          const suyos = f.tipo === "recibo" ? turnos.filter((t) => t.branchId === f.branchId) : [];
          return (
            <li key={`${f.tipo}-${f.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base">
                  {f.tipo === "gasto" ? "Gasto · " : f.tipo === "pago" ? "Pago a " : "Recibo "}
                  {f.detalle}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {fechaHoraODia.format(f.fecha)}
                  {f.sucursal && ` · ${f.sucursal}`}
                </span>
              </span>
              <span className={`tabular shrink-0 font-semibold ${f.monto < 0 ? "text-saldo-debe" : "text-saldo-favor"}`}>
                {formatearImporte(f.monto)}
              </span>
              {suyos.length > 0 && (
                <select
                  defaultValue=""
                  disabled={enCurso}
                  aria-label={`Turno para ${f.detalle}`}
                  onChange={(e) => {
                    const sessionId = e.target.value;
                    if (!sessionId) return;
                    empezar(async () => setEstado(await asignarReciboAlTurno(f.id, sessionId)));
                  }}
                  className="h-10 w-full shrink-0 rounded-lg border border-linea bg-card px-3 text-sm sm:w-auto"
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
