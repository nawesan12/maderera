"use client";

import { useEffect, useState } from "react";
import { Loader2, Monitor } from "lucide-react";
import type { CajaVinculada } from "@/lib/mostrador/offline/use-caja";

interface CajaDisponible {
  id: string;
  codigo: string;
  nombre: string | null;
  ultimaVezAt: string | null;
}

/**
 * Vincular esta máquina a una caja física.
 *
 * Aparece una sola vez, la primera. Sin vincular, el mostrador puede leer sin
 * internet pero no cobrar: la venta necesita un número que el cliente se pueda
 * llevar escrito, y ese número lleva el código de la caja.
 *
 * Se vincula **estando en línea**, a propósito: el código lo asigna el servidor
 * y no la máquina. Si cada navegador se autobautizara, dos terminarían
 * llamándose `CAJA1` y dos clientes se irían con el mismo papel; la clave de
 * idempotencia protege la base de ese duplicado, pero no protege el papel, que
 * es sobre lo que la gente discute.
 */
export function VincularCaja({
  branchId,
  enLinea,
  onVincular,
}: {
  branchId: string;
  enLinea: boolean;
  onVincular: (caja: Omit<CajaVinculada, "proximoNumero">) => Promise<void>;
}) {
  const [cajas, setCajas] = useState<CajaDisponible[] | null>(null);
  const [enCurso, setEnCurso] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enLinea) return;

    let vivo = true;
    void fetch(`/api/mostrador/caja/vincular?branchId=${branchId}`)
      .then((r) => (r.ok ? r.json() : { cajas: [] }))
      .then((datos) => {
        if (vivo) setCajas(datos.cajas ?? []);
      })
      .catch(() => {
        if (vivo) setCajas([]);
      });

    return () => {
      vivo = false;
    };
  }, [branchId, enLinea]);

  async function vincular(cajaId: string) {
    setEnCurso(true);
    setError(null);

    try {
      const respuesta = await fetch("/api/mostrador/caja/vincular", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cajaId }),
      });

      const datos = await respuesta.json();

      if (!respuesta.ok || datos.error) {
        setError(datos.error ?? "No se pudo vincular.");
        return;
      }

      await onVincular(datos.caja);
    } catch {
      setError("No se pudo vincular. Probá de nuevo.");
    } finally {
      setEnCurso(false);
    }
  }

  return (
    <div className="tarjeta flex flex-wrap items-center gap-3 border-[var(--estado-borde)] p-4">
      <span className="estado-espera flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--estado-fondo)]">
        <Monitor className="h-5 w-5" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold">Esta máquina no está vinculada</p>
        <p className="text-sm text-muted-foreground">
          {enLinea
            ? "Elegí qué caja es para poder cobrar cuando se corte internet."
            : "Conectate una vez para vincularla. Mientras tanto se puede consultar, pero no cobrar sin conexión."}
        </p>
        {error && <p className="mt-1 text-sm text-saldo-debe">{error}</p>}
      </div>

      {enLinea &&
        (cajas === null ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
        ) : cajas.length === 0 ? (
          <p className="shrink-0 text-sm text-muted-foreground">
            No hay cajas dadas de alta en esta sucursal.
          </p>
        ) : (
          <select
            defaultValue=""
            disabled={enCurso}
            onChange={(e) => {
              if (e.target.value) void vincular(e.target.value);
            }}
            className="h-11 shrink-0 rounded-lg border border-linea bg-card px-3 text-base"
          >
            <option value="">Elegí la caja…</option>
            {cajas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.codigo}
                {c.nombre ? ` · ${c.nombre}` : ""}
              </option>
            ))}
          </select>
        ))}
    </div>
  );
}
