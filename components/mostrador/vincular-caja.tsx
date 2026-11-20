"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Monitor, MonitorOff } from "lucide-react";
import type { CajaVinculada } from "@/lib/mostrador/offline/use-caja";
import { desvincularTerminal } from "@/app/mostrador/actions";

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
 * cosa (el turno), y la misma palabra para dos cosas confunde.
 *
 * Sin vincular nunca desaparece del todo (comité de T4): el problema se ve el
 * día que se corta internet, que es justo cuando no se puede vincular, y no
 * mostrar nada no daba ninguna pista de por qué no cobra. Ahí queda un ícono
 * quieto de terminal tachada. Y si la sucursal no tiene terminales dadas de
 * alta, quien puede darlas de alta ve el camino; el resto, el mismo ícono.
 *
 * Vinculada muestra el código y no el nombre: es lo que sale en el número
 * provisorio del papel (`CAJA1-017`), y con eso se lo busca después.
 *
 * Desvincular es solo del admin (el default prudente del comité final, lo
 * controla Go): para quien administra, el código es un botón que pide la
 * misma confirmación al revés. Go cambia el secreto de la caja; esta PC la
 * suelta y vuelve a pedir que se la vincule, sin perder su contador.
 */
export function VincularCaja({
  branchId,
  enLinea,
  vinculada,
  onVincular,
  onDesvincular,
  administra = false,
}: {
  branchId: string;
  enLinea: boolean;
  /** Si quien atiende puede dar de alta terminales (/admin/caja). */
  administra?: boolean;
  /** La caja de esta máquina, si ya está vinculada. */
  vinculada: { id: string; codigo: string } | null;
  onVincular: (caja: Omit<CajaVinculada, "proximoNumero">) => Promise<void>;
  /** Suelta la caja local, después de que Go la desvinculó. */
  onDesvincular?: () => Promise<void>;
}) {
  const [cajas, setCajas] = useState<CajaDisponible[] | null>(null);
  const [enCurso, setEnCurso] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * La terminal elegida, antes de vincularla. Elegirla en el selector la
   * vinculaba en el acto, y desvincular es solo del admin: un toque de más
   * dejaba esta PC numerando como otra (comité final). Ahora se confirma.
   */
  const [elegida, setElegida] = useState<CajaDisponible | null>(null);
  const [soltando, setSoltando] = useState(false);

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

  async function desvincular(cajaId: string) {
    setEnCurso(true);
    setError(null);
    try {
      const r = await desvincularTerminal(cajaId);
      if (r.error) {
        setError(r.error);
        return;
      }
      setSoltando(false);
      await onDesvincular?.();
    } catch {
      setError("No se pudo desvincular.");
    } finally {
      setEnCurso(false);
    }
  }

  // Ya vinculada: el código, quieto, para leerlo en el papel del cliente.
  if (vinculada) {
    const codigo = (
      <>
        <Monitor className="h-4 w-4" />
        {vinculada.codigo}
      </>
    );
    if (!administra || !onDesvincular || !enLinea) {
      return (
        <span className="inline-flex h-9 items-center gap-1.5 px-1 text-sm text-muted-foreground" title="Esta PC">
          {codigo}
        </span>
      );
    }
    if (soltando) {
      return (
        <span role="group" aria-label="Desvincular esta PC" className="inline-flex items-center gap-2 text-sm">
          <span className="font-semibold">¿Esta PC deja de ser {vinculada.codigo}?</span>
          <button
            type="button"
            disabled={enCurso}
            onClick={() => void desvincular(vinculada.id)}
            className="boton-accion inline-flex h-9 items-center gap-1.5 rounded-lg px-3 font-semibold disabled:opacity-50"
          >
            {enCurso && <Loader2 className="h-4 w-4 animate-spin" />}
            Sí
          </button>
          <button
            type="button"
            autoFocus
            disabled={enCurso}
            onClick={() => {
              setSoltando(false);
              setError(null);
            }}
            className="h-9 rounded-lg border border-linea px-3 font-medium hover:bg-hundida"
          >
            No
          </button>
          {error && <span className="text-sm font-medium text-saldo-debe">{error}</span>}
        </span>
      );
    }
    return (
      <button
        type="button"
        onClick={() => setSoltando(true)}
        title="Esta PC"
        aria-label={`Esta PC es ${vinculada.codigo}. Desvincular`}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg px-1.5 text-sm text-muted-foreground hover:bg-hundida"
      >
        {codigo}
      </button>
    );
  }

  const sinVincular = (
    <span
      role="img"
      aria-label="Esta PC no está vinculada a una terminal: sin conexión no puede cobrar"
      title="Esta PC no está vinculada a una terminal: sin conexión no puede cobrar"
      className="estado-espera inline-flex h-9 items-center px-1"
    >
      <MonitorOff className="h-4 w-4" />
    </span>
  );

  if (!enLinea) return sinVincular;
  // Mientras carga no se muestra nada: un círculo que gira en la barra, en
  // cada arranque, es más ruido que lo que informa.
  if (!cajas) return null;
  if (cajas.length === 0) {
    return administra ? (
      <Link
        href="/admin/caja"
        className="estado-espera inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--estado-acento)] px-2.5 text-sm font-medium"
      >
        <MonitorOff className="h-4 w-4" />
        Dar de alta terminales
      </Link>
    ) : (
      sinVincular
    );
  }

  if (elegida) {
    return (
      <span role="group" aria-label="Vincular esta PC" className="inline-flex items-center gap-2 text-sm">
        <span className="font-semibold">¿Esta PC es {elegida.codigo}?</span>
        <button
          type="button"
          disabled={enCurso}
          onClick={() => void vincular(elegida.id).then(() => setElegida(null))}
          className="boton-accion inline-flex h-9 items-center gap-1.5 rounded-lg px-3 font-semibold disabled:opacity-50"
        >
          {enCurso && <Loader2 className="h-4 w-4 animate-spin" />}
          Sí
        </button>
        <button
          type="button"
          autoFocus
          disabled={enCurso}
          onClick={() => setElegida(null)}
          className="h-9 rounded-lg border border-linea px-3 font-medium hover:bg-hundida"
        >
          No
        </button>
      </span>
    );
  }

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
            const caja = cajas.find((c) => c.id === e.target.value);
            if (caja) setElegida(caja);
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
