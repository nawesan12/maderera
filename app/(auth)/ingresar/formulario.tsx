"use client";

import { useActionState, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ingresar, type EstadoIngreso } from "./actions";
import { PedirLink } from "./pedir-link";

const estadoInicial: EstadoIngreso = {};

/**
 * Con la clave mal, el correo queda escrito (vuelve en el estado: el
 * formulario se limpia solo después de la acción) y el link al correo lo usa
 * sin volver a pedirlo (mes simulado, M2S1-067 y M3S2-023).
 */
export function FormularioIngreso({ volver, linkAbierto = false }: { volver?: string; linkAbierto?: boolean }) {
  const [estado, accion, pendiente] = useActionState(ingresar, estadoInicial);
  const [correo, setCorreo] = useState("");

  return (
    <>
    <form action={accion} className="space-y-4">
      {volver && <input type="hidden" name="volver" value={volver} />}

      <div className="space-y-2">
        <Label htmlFor="email">Correo electrónico</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={estado.correo}
          onChange={(e) => setCorreo(e.target.value)}
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
          autoFocus={Boolean(estado.error)}
          required
        />
      </div>

      {estado.error && (
        <p
          role="alert"
          className="estado-problema flex items-center gap-2 rounded-lg bg-[var(--estado-fondo)] px-3 py-2 text-sm font-medium text-[var(--estado-tinta)]"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          {estado.error}
        </p>
      )}

      <Button
        type="submit"
        disabled={pendiente}
        className="w-full bg-accion hover:bg-brand-orange-dark text-white font-medium"
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
    <PedirLink abierto={linkAbierto} correo={correo || estado.correo || ""} />
    </>
  );
}
