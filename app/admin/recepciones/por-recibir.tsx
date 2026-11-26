"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Truck } from "lucide-react";
import { fechaCorta, diasHasta } from "@/lib/formato";
import { recibirDeLaOrden } from "@/app/admin/compras/ordenes/actions";

interface Esperada {
  id: string;
  numero: string;
  estado: string;
  proveedor: string;
  sucursal: string | null;
  fechaPrometida: Date | null;
  pendientes: number;
  lineas: number;
}

/**
 * Las órdenes que se esperan, cada una con el remito a mano: llega el camión,
 * se escribe el número y queda la recepción en borrador con lo que falta,
 * para corregir lo que vino y confirmar.
 */
export function PorRecibir({ ordenes }: { ordenes: Esperada[] }) {
  return (
    <section className="tarjeta overflow-hidden">
      <h2 className="flex items-baseline gap-2 px-5 pt-5 text-[19px] font-bold tracking-tight">
        Por recibir
        <span className="tabular text-base font-medium text-muted-foreground">{ordenes.length}</span>
      </h2>
      <ul className="mt-2 divide-y divide-linea">
        {ordenes.map((o) => (
          <Fila key={o.id} orden={o} />
        ))}
      </ul>
    </section>
  );
}

function Fila({ orden: o }: { orden: Esperada }) {
  const router = useRouter();
  const [remito, setRemito] = useState("");
  const [error, setError] = useState("");
  const [enCurso, empezar] = useTransition();
  const dias = diasHasta(o.fechaPrometida);
  return (
    <li className="grid gap-2 px-5 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)_auto] md:items-center">
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="codigo font-semibold">{o.numero}</span>
          <span className="truncate">{o.proveedor}</span>
        </p>
        <p className="tabular text-base text-muted-foreground">
          {o.sucursal ?? "—"}
          {o.fechaPrometida && (
            <span className={dias !== null && dias < 0 ? "font-medium text-saldo-debe" : undefined}>
              {" · "}
              {fechaCorta.format(o.fechaPrometida)}
            </span>
          )}
          {o.estado === "parcial" && ` · faltan ${o.pendientes} de ${o.lineas}`}
        </p>
      </div>
      <input
        value={remito}
        onChange={(e) => setRemito(e.target.value)}
        aria-label={`Número de remito de ${o.numero}`}
        placeholder="N.º de remito"
        className="codigo h-12 w-full rounded-lg border border-linea bg-background px-3 text-base"
      />
      <button
        type="button"
        disabled={enCurso}
        onClick={() =>
          empezar(async () => {
            const r = await recibirDeLaOrden(o.id, remito);
            setError(r.error ?? "");
            if (r.id) router.push(`/admin/recepciones/${r.id}`);
          })
        }
        className="boton-accion inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl px-5 text-base font-semibold disabled:opacity-60 md:w-auto"
      >
        {enCurso ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
        Recibir
      </button>
      {error && (
        <p className="text-base font-medium text-saldo-debe md:col-span-3" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
