"use client";

import { useActionState, useState, useTransition } from "react";
import { AlertCircle, CheckCircle2, Loader2, Send } from "lucide-react";
import { diagnosticar, guardarTope, mensajeDePrueba, sincronizar, type EstadoAviso } from "./acciones";
import { CATEGORIAS_COBRO, NOMBRE_CATEGORIA, type CategoriaCobro } from "@/lib/whatsapp/costos";

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
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-verde-whatsapp px-3.5 text-base font-medium text-white transition-colors hover:bg-brand-green/90 disabled:opacity-60"
      >
        {pendiente ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
        Mandar mensaje de prueba
      </button>
      <Resultado estado={estado} />
    </form>
  );
}

/** El tope del mes y las tarifas por categoría, en USD. */
export function FormularioTope({ tope, tarifas }: { tope: number; tarifas: Record<CategoriaCobro, number> }) {
  const [estado, accion, pendiente] = useActionState(guardarTope, {});
  const coma = (n: number) => String(n).replace(".", ",");
  return (
    <form action={accion} className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <label className="block">
          <span className="text-sm text-muted-foreground">Tope por mes (USD)</span>
          <input
            name="tope"
            required
            inputMode="decimal"
            defaultValue={coma(tope)}
            className="tabular mt-0.5 block h-10 w-32 rounded-lg border bg-background px-2.5 text-base"
          />
        </label>
        {CATEGORIAS_COBRO.map((c) => (
          <label key={c} className="block">
            <span className="text-sm text-muted-foreground">{NOMBRE_CATEGORIA[c]}</span>
            <input
              name={c}
              required
              inputMode="decimal"
              defaultValue={coma(tarifas[c])}
              className="tabular mt-0.5 block h-10 w-32 rounded-lg border bg-background px-2.5 text-base"
            />
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pendiente}
          className="inline-flex h-10 items-center gap-2 rounded-lg border bg-background px-3.5 text-base font-medium transition-colors hover:bg-muted disabled:opacity-60"
        >
          {pendiente && <Loader2 className="h-5 w-5 animate-spin" />}
          Guardar tope y tarifas
        </button>
        <Resultado estado={estado} />
      </div>
    </form>
  );
}
