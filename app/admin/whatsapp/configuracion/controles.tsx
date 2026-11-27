"use client";

import { useActionState, useState, useTransition } from "react";
import { AlertCircle, CheckCircle2, Loader2, Send } from "lucide-react";
import { diagnosticar, guardarTopes, mensajeDePrueba, sincronizar, type EstadoAviso } from "./acciones";
import { CATEGORIAS_COBRO, NOMBRE_CATEGORIA, type CategoriaCobro } from "@/lib/whatsapp/costos";

function Resultado({ estado }: { estado: EstadoAviso }) {
  if (estado.error) {
    return (
      <p role="alert" className="flex items-start gap-1.5 text-base text-saldo-debe">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
        {estado.error}
      </p>
    );
  }
  if (estado.ok) {
    return (
      <p role="status" className="flex items-start gap-1.5 text-base text-saldo-favor">
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

type UsoMensajes = { usados: number; tope: number; proporcion: number; ahorro: boolean; alcanzado: boolean };
type Gasto = { usd: number; tope: number; proporcion: number; alcanzado: boolean; umbral: number | null };

/** Una barra de lo usado contra el tope, en el color de cómo viene. */
function Medidor({
  etiqueta,
  usado,
  de,
  proporcion,
  alcanzado,
  cerca,
}: {
  etiqueta: string;
  usado: string;
  de: string;
  proporcion: number;
  alcanzado: boolean;
  cerca: boolean;
}) {
  const porcentaje = Math.round(proporcion * 100);
  return (
    <div className="min-w-0 space-y-2">
      <p className="text-sm font-medium text-muted-foreground">{etiqueta}</p>
      <p className="flex flex-wrap items-baseline gap-x-2 text-base">
        <span className="tabular text-2xl font-semibold">{usado}</span>
        <span className="text-muted-foreground">de {de}</span>
        <span
          className={`tabular ml-auto ${alcanzado ? "estado-problema font-medium text-[var(--estado-tinta)]" : cerca ? "estado-espera font-medium text-[var(--estado-tinta)]" : "text-muted-foreground"}`}
        >
          {porcentaje} %
        </span>
      </p>
      <div
        role="meter"
        aria-label={`${etiqueta} contra el tope`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(porcentaje, 100)}
        className="h-3 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={`h-full rounded-full ${alcanzado ? "bg-destructive" : cerca ? "bg-amber-500" : "bg-brand-green"}`}
          style={{ width: `${Math.min(porcentaje, 100)}%` }}
        />
      </div>
    </div>
  );
}

/**
 * El tope del mes en un solo bloque (M2S1-050): los mensajes del bot y los
 * dólares de la API, cada uno con su barra, y un solo formulario con los dos
 * topes y las tarifas. Antes eran dos tarjetas en dos lugares de la página.
 */
export function TopeDelMes({
  mensajes,
  gasto,
  tarifas,
}: {
  mensajes: UsoMensajes;
  gasto: Gasto;
  tarifas: Record<CategoriaCobro, number>;
}) {
  const [estado, accion, pendiente] = useActionState(guardarTopes, {});
  const coma = (n: number) => String(n).replace(".", ",");
  const dolar = (n: number) => `USD ${n.toFixed(2).replace(".", ",")}`;
  const campo = "tabular mt-0.5 block h-10 w-full rounded-lg border bg-background px-2.5 text-base";
  return (
    <div className={mensajes.alcanzado || gasto.alcanzado ? "tarjeta-atencion space-y-5 p-5" : "tarjeta space-y-5 p-5"}>
      <div className="grid gap-5 sm:grid-cols-2">
        <Medidor
          etiqueta="Mensajes del bot"
          usado={String(mensajes.usados)}
          de={String(mensajes.tope)}
          proporcion={mensajes.proporcion}
          alcanzado={mensajes.alcanzado}
          cerca={mensajes.ahorro}
        />
        <Medidor
          etiqueta="Gasto de la API"
          usado={dolar(gasto.usd)}
          de={dolar(gasto.tope)}
          proporcion={gasto.proporcion}
          alcanzado={gasto.alcanzado}
          cerca={gasto.umbral === 80}
        />
      </div>
      <form action={accion} className="space-y-3 border-t pt-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <label className="block min-w-0">
            <span className="text-sm text-muted-foreground">Tope de mensajes</span>
            <input name="topeMensajes" required inputMode="numeric" defaultValue={mensajes.tope} className={campo} />
          </label>
          <label className="block min-w-0">
            <span className="text-sm text-muted-foreground">Tope (USD)</span>
            <input name="tope" required inputMode="decimal" defaultValue={coma(gasto.tope)} className={campo} />
          </label>
          {CATEGORIAS_COBRO.map((c) => (
            <label key={c} className="block min-w-0">
              <span className="text-sm text-muted-foreground">{NOMBRE_CATEGORIA[c]}</span>
              <input name={c} required inputMode="decimal" defaultValue={coma(tarifas[c])} className={campo} />
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pendiente}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-accion px-4 text-base font-medium text-white disabled:opacity-60"
          >
            {pendiente && <Loader2 className="h-5 w-5 animate-spin" />}
            Guardar topes
          </button>
          <Resultado estado={estado} />
        </div>
      </form>
    </div>
  );
}
