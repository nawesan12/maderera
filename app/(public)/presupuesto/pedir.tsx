"use client";

import { useActionState, useState } from "react";
import { AlertCircle, Check, Clock, Loader2, Send } from "lucide-react";
import { pedirPresupuesto, type EstadoPresupuesto } from "./actions";

const inicial: EstadoPresupuesto = {};

export interface SucursalElegible {
  id: string;
  nombre: string;
}

/**
 * Pedir el presupuesto armado.
 *
 * Antes el único camino era un link de WhatsApp con el detalle en el texto: si
 * nadie lo copiaba a algún lado, el pedido se perdía en el chat. Esto lo deja
 * registrado con número, y el de WhatsApp sigue estando para quien lo prefiera.
 *
 * El formulario está plegado hasta que se lo pide: en la pantalla del carrito lo
 * que manda es el botón de comprar, y cinco campos abiertos compiten con él.
 */
export function PedirPresupuesto({
  sucursales,
  nombre,
  email,
  telefono,
  esProfesional,
}: {
  sucursales: SucursalElegible[];
  nombre?: string | null;
  email?: string | null;
  telefono?: string | null;
  esProfesional: boolean;
}) {
  const [estado, accion, enviando] = useActionState(pedirPresupuesto, inicial);
  const [abierto, setAbierto] = useState(false);

  if (estado.ok) {
    return (
      <div className="rounded-xl border border-brand-green/30 bg-brand-green/5 p-5">
        <p className="flex items-start gap-2 text-sm">
          <Check className="mt-0.5 h-5 w-5 shrink-0 text-brand-green" />
          {estado.ok}
        </p>
      </div>
    );
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border text-base font-medium transition-colors hover:bg-muted"
      >
        <Send className="h-4 w-4" />
        Pedir presupuesto por escrito
      </button>
    );
  }

  return (
    <form action={accion} className="space-y-3 rounded-xl border p-4">
      <div>
        <p className="font-medium">Pedir el presupuesto</p>
        <p className="text-sm text-muted-foreground">
          {esProfesional
            ? "Te contestamos dentro de las 24 horas hábiles."
            : "Te lo mandamos armado por correo."}
        </p>
      </div>

      {esProfesional && (
        <p className="flex items-center gap-2 rounded-lg bg-brand-orange/10 px-3 py-2 text-sm text-brand-orange-dark">
          <Clock className="h-4 w-4 shrink-0" />
          Entra por la cola express
        </p>
      )}

      <Campo
        nombre="nombre"
        etiqueta="Nombre"
        defecto={nombre}
        autoComplete="name"
        requerido
      />
      <Campo
        nombre="email"
        etiqueta="Correo"
        tipo="email"
        defecto={email}
        autoComplete="email"
        requerido
      />
      <Campo
        nombre="telefono"
        etiqueta="Teléfono"
        defecto={telefono}
        autoComplete="tel"
        requerido
      />

      {sucursales.length > 0 && (
        <div>
          <label htmlFor="sucursalId" className="block text-sm font-medium">
            Sucursal
          </label>
          <select
            id="sucursalId"
            name="sucursalId"
            className="mt-1 h-11 w-full rounded-lg border bg-background px-3 text-base"
          >
            <option value="">La que quede mejor</option>
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label htmlFor="notas" className="block text-sm font-medium">
          Algo que tengamos que saber
        </label>
        <textarea
          id="notas"
          name="notas"
          rows={2}
          placeholder="Medidas especiales, plazo de obra, forma de pago…"
          className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-base"
        />
      </div>

      {estado.error && (
        <p className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {estado.error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={enviando}
          className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-brand-orange text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
        >
          {enviando ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Enviando…
            </>
          ) : (
            "Enviar el pedido"
          )}
        </button>
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="inline-flex h-11 items-center rounded-lg border px-4 text-base font-medium transition-colors hover:bg-muted"
        >
          Cancelar
        </button>
      </div>

      <p className="text-sm text-muted-foreground">
        Tu presupuesto queda igual: pedirlo por escrito no vacía el carrito.
      </p>
    </form>
  );
}

function Campo({
  nombre,
  etiqueta,
  tipo = "text",
  defecto,
  autoComplete,
  requerido = false,
}: {
  nombre: string;
  etiqueta: string;
  tipo?: string;
  defecto?: string | null;
  autoComplete?: string;
  requerido?: boolean;
}) {
  return (
    <div>
      <label htmlFor={nombre} className="block text-sm font-medium">
        {etiqueta}
        {requerido && <span className="text-brand-orange"> *</span>}
      </label>
      <input
        id={nombre}
        name={nombre}
        type={tipo}
        required={requerido}
        defaultValue={defecto ?? undefined}
        autoComplete={autoComplete}
        className="mt-1 h-11 w-full rounded-lg border bg-background px-3 text-base"
      />
    </div>
  );
}
