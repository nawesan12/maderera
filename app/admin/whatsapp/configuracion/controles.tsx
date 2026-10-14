"use client";

import { useActionState, useState, useTransition } from "react";
import { AlertCircle, CheckCircle2, Loader2, Send } from "lucide-react";
import { diagnosticar, mensajeDePrueba, sincronizar, type EstadoAviso } from "./acciones";

function Resultado({ estado }: { estado: EstadoAviso }) {
  if (estado.error) {
    return (
      <p role="alert" className="flex items-start gap-1.5 text-base text-red-700">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
        {estado.error}
      </p>
    );
  }
  if (estado.ok) {
    return (
      <p role="status" className="flex items-start gap-1.5 text-base text-green-800">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
        {estado.ok}
      </p>
    );
  }
  return null;
}

/** Un botón que corre una acción del servidor y dice cómo le fue. */
export function BotonAccion({
  accion,
  texto,
  icono,
}: {
  accion: "diagnosticar" | "sincronizar";
  texto: string;
  icono: React.ReactNode;
}) {
  const [pendiente, iniciar] = useTransition();
  const [estado, setEstado] = useState<EstadoAviso>({});
  const correr = accion === "diagnosticar" ? diagnosticar : sincronizar;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pendiente}
        onClick={() => iniciar(async () => setEstado(await correr()))}
        className="inline-flex h-10 items-center gap-2 rounded-lg border bg-background px-3.5 text-base font-medium transition-colors hover:bg-muted disabled:opacity-60"
      >
        {pendiente ? <Loader2 className="h-5 w-5 animate-spin" /> : icono}
        {texto}
      </button>
      <Resultado estado={estado} />
    </div>
  );
}

/** El mensaje de prueba: a qué número y qué pasó. */
export function MensajeDePrueba() {
  const [estado, accion, pendiente] = useActionState(mensajeDePrueba, {});
  return (
    <form action={accion} className="space-y-2">
      <label className="block max-w-sm">
        <span className="text-sm text-muted-foreground">Número que va a recibir la prueba</span>
        <input
          name="telefono"
          required
          inputMode="tel"
          placeholder="223 590-3118"
          className="tabular mt-0.5 h-10 w-full rounded-lg border bg-background px-2.5 text-base"
        />
      </label>
      <button
        type="submit"
        disabled={pendiente}
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-green px-3.5 text-base font-medium text-white transition-colors hover:bg-brand-green/90 disabled:opacity-60"
      >
        {pendiente ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
        Mandar mensaje de prueba
      </button>
      <Resultado estado={estado} />
    </form>
  );
}
