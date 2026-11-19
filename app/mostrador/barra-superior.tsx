"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Banknote, WifiOff } from "lucide-react";
import { formatearMonto } from "@/lib/formato";
import type { EstadoCola } from "@/lib/mostrador/offline/use-cola";
import type { EstadoConexion } from "@/lib/mostrador/offline/use-conexion";
import type { Sucursal, Turno } from "./tipos";

export function BarraSuperior({
  conexion,
  cola,
  usuario,
  sucursales,
  sucursal,
  turno,
  onCaja,
  terminal,
}: {
  conexion: EstadoConexion;
  cola: EstadoCola;
  usuario: { nombre: string };
  sucursales: Sucursal[];
  sucursal: Sucursal;
  turno: Turno | null;
  onCaja: () => void;
  /** La terminal de esta máquina: el código, o el selector para vincularla. */
  terminal?: ReactNode;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-linea px-4">
      <Link href="/admin" className="text-base font-bold tracking-tight">
        Mostrador
      </Link>

      <div className="flex items-center gap-1.5">
        {sucursales.map((s) => (
          <Link
            key={s.id}
            href={`/mostrador?sucursal=${s.slug}`}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              s.id === sucursal.id
                ? "bg-accion text-white"
                : "text-muted-foreground hover:bg-hundida"
            }`}
          >
            {s.nombre}
          </Link>
        ))}
      </div>

      {/* El estado de conexión, medido con el latido y no con
          `navigator.onLine`, que en un wifi sin salida a internet dice que sí.
          Va acá arriba porque cambia lo que se puede hacer: sin servidor no se
          abre ni se cierra caja, y el comprobante fiscal queda deshabilitado. */}
      {!conexion.enLinea && (
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--estado-fondo)] px-2.5 py-1 text-sm font-semibold estado-espera">
          <WifiOff className="h-3.5 w-3.5" />
          Sin conexión
        </span>
      )}

      {cola.sinSubir > 0 && (
        // Se suben solas cuando vuelve la conexión.
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--estado-fondo)] px-2.5 py-1 text-sm font-semibold estado-espera">
          {cola.sinSubir} ventas sin enviar
        </span>
      )}

      {cola.atascadas > 0 && (
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--estado-fondo)] px-2.5 py-1 text-sm font-semibold estado-problema">
          {cola.atascadas} venta{cola.atascadas > 1 ? "s" : ""} trabada
          {cola.atascadas > 1 ? "s" : ""}
        </span>
      )}

      {conexion.desfasajeMin !== null && (
        // La hora de esta máquina se usa para las ventas hechas sin conexión.
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--estado-fondo)] px-2.5 py-1 text-sm font-semibold estado-problema">
          Reloj corrido {conexion.desfasajeMin} min
        </span>
      )}

      <span className="ml-auto" />
      {terminal}

      {/* Abierta, dice cuánto hay; cerrada, dice lo que hay que hacer y se ve
          como botón —borde y flecha—: «Caja cerrada» se leía como un estado y
          nadie la tocaba (T4, hallazgo 19). */}
      <button
        onClick={onCaja}
        className={`inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-sm font-semibold transition-colors ${
          turno
            ? "estado-ok bg-[var(--estado-fondo)] text-[var(--estado-tinta)]"
            : "estado-problema border border-[var(--estado-acento)] bg-[var(--estado-fondo)] text-[var(--estado-tinta)] hover:brightness-95"
        }`}
      >
        <Banknote className="h-4 w-4" />
        {turno ? (
          `Caja ${formatearMonto(turno.esperado)}`
        ) : (
          <>
            Abrir caja
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>

      <span className="text-sm text-muted-foreground">{usuario.nombre}</span>
    </header>
  );
}
