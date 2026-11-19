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
 * Vincular esta máquina a una caja física, desde la barra de arriba.
 *
 * Sin vincular, el mostrador puede leer sin internet pero no cobrar: la venta
 * necesita un número que el cliente se pueda llevar escrito, y ese número
 * lleva el código de la caja.
 *
 * Se vincula **estando en línea**, a propósito: el código lo asigna el servidor
 * y no la máquina. Si cada navegador se autobautizara, dos terminarían
 * llamándose `CAJA1` y dos clientes se irían con el mismo papel; la clave de
 * idempotencia protege la base de ese duplicado, pero no protege el papel, que
 * es sobre lo que la gente discute.
 *
 * Antes era una franja con dos frases arriba de la venta (T4, hallazgo 19).
 * Ahora es un selector del mismo alto que la píldora del turno y en segundo
 * plano: sin la palabra «caja», porque al lado está «Abrir caja», que es otra
 * cosa (el turno), y la misma palabra para dos cosas confunde. Sin cajas
 * dadas de alta o sin conexión no aparece: el que atiende no tiene nada que
 * hacer ahí, y un cartel que no se puede resolver es ruido.
 */
export function VincularCaja({
  branchId,
  enLinea,
  vinculada,
  onVincular,
}: {
  branchId: string;
  enLinea: boolean;
  /** El código de la caja de esta máquina, si ya está vinculada. */
  vinculada: string | null;
  onVincular: (caja: Omit<CajaVinculada, "proximoNumero">) => Promise<void>;
}) {
  const [cajas, setCajas] = useState<CajaDisponible[] | null>(null);
  const [enCurso, setEnCurso] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enLinea || vinculada) return;

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
  }, [branchId, enLinea, vinculada]);

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
      setError("No se pudo vincular.");
    } finally {
      setEnCurso(false);
    }
  }

  // Ya vinculada: el código, quieto, para leerlo en el papel del cliente.
  if (vinculada) {
    return (
      <span className="inline-flex h-9 items-center gap-1.5 px-1 text-sm text-muted-foreground" title="Esta PC">
        <Monitor className="h-4 w-4" />
        {vinculada}
      </span>
    );
  }

  // Mientras carga no se muestra nada: un círculo que gira en la barra, en
  // cada arranque, es más ruido que lo que informa.
  if (!enLinea || !cajas || cajas.length === 0) return null;

  return (
    <span className="inline-flex items-center gap-2">
      <label className="estado-espera inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--estado-acento)] pl-2.5 text-sm font-medium">
        {enCurso ? <Loader2 className="h-4 w-4 animate-spin" /> : <Monitor className="h-4 w-4" />}
        <span className="sr-only">Qué terminal es esta PC</span>
        {/* Controlado y siempre en blanco: si falla, elegir la misma otra vez
            tiene que volver a intentar, y un `select` que ya la muestra
            elegida no dispara `onChange`. */}
        <select
          value=""
          disabled={enCurso}
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            if (e.target.value) void vincular(e.target.value);
          }}
          className="h-full rounded-r-lg bg-transparent pr-2 text-sm font-medium outline-none"
        >
          <option value="">Esta PC…</option>
          {cajas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.codigo}
              {c.nombre ? ` · ${c.nombre}` : ""}
            </option>
          ))}
        </select>
      </label>
      {error && <span className="text-sm font-medium text-saldo-debe">{error}</span>}
    </span>
  );
}
