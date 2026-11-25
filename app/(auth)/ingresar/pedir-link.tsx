"use client";

import { useActionState, useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { pedirEnlace, type EstadoPedidoEnlace } from "./actions";

const inicial: EstadoPedidoEnlace = {};

/** Entrar sin contraseña: un link de un solo uso al correo de la cuenta. */
export function PedirLink({ abierto: deEntrada = false }: { abierto?: boolean }) {
  const [abierto, setAbierto] = useState(deEntrada);
  const [estado, accion, pendiente] = useActionState(pedirEnlace, inicial);

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[10px] border border-linea text-[15px] font-semibold transition-colors hover:bg-sitio-alt"
      >
        <Mail className="h-4 w-4" />
        Entrar con un link al correo
      </button>
    );
  }

  if (estado.enviado) {
    return (
      <p className="mt-5 rounded-[10px] bg-naranja-claro px-4 py-3 text-[15px] text-acento-sobre-claro">
        Si ese correo tiene cuenta, te llega un link para entrar. Vence en 15 minutos.
      </p>
    );
  }

  return (
    <form action={accion} className="mt-5 space-y-2 border-t border-linea pt-5">
      <label htmlFor="correo-link" className="block text-sm font-medium">
        Tu correo
      </label>
      <div className="flex gap-2">
        <input
          id="correo-link"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="h-11 min-w-0 flex-1 rounded-[10px] border border-linea bg-background px-3 text-base"
        />
        <button
          type="submit"
          disabled={pendiente}
          className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-accion px-4 font-semibold text-white hover:bg-accion-hover disabled:opacity-60"
        >
          {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
          Mandar
        </button>
      </div>
      {estado.error && <p className="text-sm text-destructive">{estado.error}</p>}
    </form>
  );
}
