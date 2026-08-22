"use client";

import { useActionState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ingresar, type EstadoIngreso } from "./actions";

const estadoInicial: EstadoIngreso = {};

export function FormularioIngreso({ volver }: { volver?: string }) {
  const [estado, accion, pendiente] = useActionState(ingresar, estadoInicial);

  return (
    <form action={accion} className="space-y-4">
      {volver && <input type="hidden" name="volver" value={volver} />}

      <div className="space-y-2">
        <Label htmlFor="email">Correo electrónico</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="tunombre@mjbj.com.ar"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Contraseña</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

      {estado.error && (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-lg bg-brand-red/10 px-3 py-2 text-sm text-brand-red"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          {estado.error}
        </p>
      )}

      <Button
        type="submit"
        disabled={pendiente}
        className="w-full bg-brand-orange hover:bg-brand-orange-dark text-white font-medium"
      >
        {pendiente ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Ingresando…
          </>
        ) : (
          "Ingresar"
        )}
      </Button>
    </form>
  );
}
