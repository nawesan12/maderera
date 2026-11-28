"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { elegirClaveConEnlace, type EstadoIngreso } from "../../../ingresar/actions";

const inicial: EstadoIngreso = {};

export function ElegirClave({ token }: { token: string }) {
  const [estado, accion, pendiente] = useActionState(elegirClaveConEnlace, inicial);
  const [ver, setVer] = useState(false);

  return (
    <form action={accion} className="mt-6 space-y-4">
      <input type="hidden" name="token" value={token} />
      <div>
        <label htmlFor="password" className="block text-sm font-medium">
          Contraseña
        </label>
        <div className="relative mt-1">
          <input
            id="password"
            name="password"
            type={ver ? "text" : "password"}
            required
            minLength={8}
            autoComplete="new-password"
            spellCheck={false}
            aria-invalid={estado.error ? true : undefined}
            aria-describedby={estado.error ? "clave-error" : "clave-ayuda"}
            className="h-12 w-full rounded-[10px] border border-linea bg-background px-3 pr-12 text-base"
          />
          <button
            type="button"
            onClick={() => setVer((v) => !v)}
            aria-label={ver ? "Ocultar la contraseña" : "Mostrar la contraseña"}
            aria-pressed={ver}
            className="absolute right-0.5 top-0.5 flex h-11 w-11 items-center justify-center rounded-[10px] text-muted-foreground hover:text-foreground"
          >
            {ver ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>
        {estado.error ? (
          <p id="clave-error" role="alert" className="mt-1.5 text-sm font-medium text-destructive">
            {estado.error}
          </p>
        ) : (
          <p id="clave-ayuda" className="mt-1.5 text-sm text-texto-3">
            8 caracteres o más.
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={pendiente}
        className="inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-[10px] bg-accion text-base font-semibold text-white transition-colors hover:bg-accion-hover disabled:opacity-60"
      >
        {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
        Guardar y entrar
      </button>
    </form>
  );
}
