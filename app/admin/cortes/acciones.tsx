"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Check, Flame, Loader2, Minus, Plus, X } from "lucide-react";
import { alternarUrgente, avanzarCorte, volverCorte } from "./actions";

const SIGUIENTE: Record<string, string> = {
  "en-cola": "Empezar",
  "en-proceso": "Marcar terminado",
  terminado: "Marcar retirado",
};

/** El estado al que llega cada avance: de ahí se deshace. */
const DESPUES: Record<string, string> = {
  "en-cola": "en-proceso",
  "en-proceso": "terminado",
};

export function AccionesCorte({
  id,
  estado,
  urgente,
  pasadas = 0,
  compacto = false,
  soloMaquina = false,
}: {
  id: string;
  estado: string;
  urgente: boolean;
  /**
   * Las pasadas a cobrar que propone el plano. Al terminar, el taller las
   * confirma o las corrige ahí mismo, sin salir a la ficha (mes simulado,
   * H403). Cero: no hay nada que confirmar (se vende la placa entera).
   */
  pasadas?: number;
  compacto?: boolean;
  /**
   * En el taller, el aserradero empieza y termina. Marcar urgente y entregar
   * son decisiones del mostrador (y Go las rechaza para ese rol).
   */
  soloMaquina?: boolean;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  /*
   * El corte terminado que no está cobrado no se entrega con un clic (mes
   * simulado, H173): Go lo rechaza, y el botón pasa a «Entregar sin cobrar»
   * —el segundo toque, sabiéndolo— con «Cobrar en el mostrador» al lado.
   */
  const [sinCobrar, setSinCobrar] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [cuantas, setCuantas] = useState(pasadas);

  function accion(fn: () => Promise<{ ok?: string; error?: string }>, deshacer?: () => Promise<{ ok?: string; error?: string }>) {
    startTransition(async () => {
      const resultado = await fn();
      if (resultado.error?.includes("no está cobrado")) {
        setSinCobrar(true);
        toast.error(resultado.error);
        return;
      }
      setSinCobrar(false);
      if (resultado.error) toast.error(resultado.error);
      else
        toast.success(resultado.ok ?? "Listo.", {
          // Un toque equivocado en la tablet se revierte desde el aviso
          // (mes simulado, H116).
          ...(deshacer
            ? {
                action: {
                  label: "Deshacer",
                  onClick: () =>
                    startTransition(async () => {
                      const r = await deshacer();
                      if (r.error) toast.error(r.error);
                      else toast.success(r.ok ?? "Listo.");
                      router.refresh();
                    }),
                },
              }
            : {}),
        });
      // También con error: si fue un 409 («ya estaba en la máquina»), la
      // pantalla tiene que mostrar el estado de verdad.
      router.refresh();
    });
  }

  function avanzar(conPasadas?: number, entregarSinCobrar = false) {
    const llega = DESPUES[estado];
    accion(
      () => avanzarCorte(id, estado, conPasadas, entregarSinCobrar),
      llega ? () => volverCorte(id, llega) : undefined,
    );
  }

  const etiqueta = soloMaquina && estado === "terminado" ? undefined : SIGUIENTE[estado];
  const alto = "h-12";

  if (confirmando) {
    return (
      <form
        className="flex w-full flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setConfirmando(false);
          avanzar(cuantas);
        }}
      >
        <label htmlFor={`pasadas-${id}`} className="text-base font-medium">
          Pasadas
        </label>
        <div className="flex items-center rounded-lg bg-hundida">
          <button
            type="button"
            onClick={() => setCuantas((n) => Math.max(0, n - 1))}
            aria-label="Una pasada menos"
            className={`inline-flex ${alto} w-12 items-center justify-center rounded-lg text-foreground hover:bg-muted`}
          >
            <Minus className="h-5 w-5" />
          </button>
          <input
            id={`pasadas-${id}`}
            type="number"
            inputMode="numeric"
            min={0}
            value={cuantas}
            onChange={(e) => setCuantas(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
            className={`tabular ${alto} w-16 bg-transparent text-center text-xl font-semibold`}
          />
          <button
            type="button"
            onClick={() => setCuantas((n) => n + 1)}
            aria-label="Una pasada más"
            className={`inline-flex ${alto} w-12 items-center justify-center rounded-lg text-foreground hover:bg-muted`}
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>
        <div className="flex min-w-0 flex-1 gap-2">
          <button
            type="button"
            onClick={() => {
              setConfirmando(false);
              setCuantas(pasadas);
            }}
            aria-label="Cancelar"
            className={`inline-flex ${alto} w-12 shrink-0 items-center justify-center rounded-lg border text-muted-foreground hover:bg-muted`}
          >
            <X className="h-5 w-5" />
          </button>
          <button
            type="submit"
            autoFocus
            disabled={pendiente}
            className={`boton-accion inline-flex ${alto} min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-base font-medium disabled:opacity-50`}
          >
            <Check className="h-5 w-5" />
            Terminado
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${compacto ? "w-full" : ""}`}>
      {estado !== "retirado" && estado !== "cancelado" && !soloMaquina && (
        <button
          onClick={() => accion(() => alternarUrgente(id))}
          disabled={pendiente}
          aria-pressed={urgente}
          title={urgente ? "Quitar la urgencia" : "Marcar como urgente"}
          className={`inline-flex ${alto} items-center justify-center gap-1.5 rounded-lg px-3 text-base font-medium transition-colors disabled:opacity-50 ${
            compacto ? "min-w-0 flex-1 basis-0" : ""
          } ${
            urgente
              ? "bg-brand-orange/15 text-brand-orange-dark hover:bg-brand-orange/25"
              : "border text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <Flame className="h-5 w-5" />
          Urgente
        </button>
      )}

      {etiqueta && sinCobrar && estado === "terminado" && (
        <Link
          href={`/mostrador?corte=${id}`}
          className={`inline-flex ${alto} items-center justify-center gap-1.5 rounded-lg boton-accion px-3 text-base font-medium ${compacto ? "min-w-0 flex-1 basis-0" : ""}`}
        >
          Cobrar en el mostrador
        </Link>
      )}

      {etiqueta && (
        <button
          onClick={() => {
            if (estado === "en-proceso" && pasadas > 0) {
              setCuantas(pasadas);
              setConfirmando(true);
            } else avanzar(undefined, sinCobrar && estado === "terminado");
          }}
          disabled={pendiente}
          className={`inline-flex ${alto} items-center justify-center gap-1.5 rounded-lg px-3 text-base font-medium transition-colors disabled:opacity-50 ${
            sinCobrar && estado === "terminado" ? "border border-destructive/40 text-destructive hover:bg-destructive/10" : "boton-accion"
          } ${compacto ? "min-w-0 flex-1 basis-0" : ""}`}
        >
          {pendiente ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <ArrowRight className="h-5 w-5" />
          )}
          {sinCobrar && estado === "terminado" ? "Entregar sin cobrar" : etiqueta}
        </button>
      )}
    </div>
  );
}

/** Volver un paso atrás desde la ficha: el mismo deshacer del aviso. */
export function VolverUnPaso({ id, estado }: { id: string; estado: string }) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const texto = estado === "en-proceso" ? "Volver a la cola" : estado === "terminado" ? "Volver a la máquina" : null;
  if (!texto) return null;
  return (
    <button
      type="button"
      disabled={pendiente}
      onClick={() =>
        startTransition(async () => {
          const r = await volverCorte(id, estado);
          if (r.error) toast.error(r.error);
          else toast.success(r.ok ?? "Listo.");
          router.refresh();
        })
      }
      className="inline-flex h-12 items-center gap-1.5 rounded-lg px-3 text-base font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
    >
      {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
      {texto}
    </button>
  );
}
