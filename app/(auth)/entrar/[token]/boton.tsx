"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { entrarConEnlace, type EstadoIngreso } from "../../ingresar/actions";

const inicial: EstadoIngreso = {};

export function BotonEntrar({ token }: { token: string }) {
  const [estado, accion, pendiente] = useActionState(entrarConEnlace, inicial);

  if (estado.error) {
    return (
      <div className="mt-5 space-y-4">
        <p className="text-base text-texto-2">{estado.error}</p>
        <Link
          href="/ingresar?link=1"
          className="inline-flex h-[52px] w-full items-center justify-center rounded-[10px] border border-linea font-semibold transition-colors hover:bg-sitio-alt"
        >
          Pedir un link nuevo
        </Link>
      </div>
    );
  }

  return (
    <form action={accion} className="mt-6">
      <input type="hidden" name="token" value={token} />
      <button
        type="submit"
        disabled={pendiente}
        className="inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-[10px] bg-accion text-base font-semibold text-white transition-colors hover:bg-accion-hover disabled:opacity-60"
      >
        {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
        Entrar
      </button>
    </form>
  );
}
