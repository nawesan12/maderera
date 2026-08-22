"use client";

import { useActionState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { registrarse, type EstadoRegistro } from "./actions";

const estadoInicial: EstadoRegistro = {};

export function FormularioRegistro({ volver }: { volver?: string }) {
  const [estado, accion, pendiente] = useActionState(registrarse, estadoInicial);

  return (
    <form action={accion} className="space-y-4">
      {volver && <input type="hidden" name="volver" value={volver} />}

      <div className="space-y-2">
        <Label htmlFor="nombre">Nombre y apellido</Label>
        <Input
          id="nombre"
          name="nombre"
          autoComplete="name"
          placeholder="Juan Pérez"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Correo electrónico</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="juan@ejemplo.com"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="telefono">Teléfono</Label>
        <Input
          id="telefono"
          name="telefono"
          type="tel"
          autoComplete="tel"
          placeholder="223 590-3118"
          required
        />
        <p className="text-xs text-muted-foreground">
          Lo usamos para avisarte cuando el pedido esté listo.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="password">Contraseña</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="repetir">Repetir contraseña</Label>
          <Input
            id="repetir"
            name="repetir"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
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
        className="w-full bg-brand-orange font-medium text-white hover:bg-brand-orange-dark"
      >
        {pendiente ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Creando la cuenta…
          </>
        ) : (
          "Crear mi cuenta"
        )}
      </Button>
    </form>
  );
}
