"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Check, Flame, Loader2, Minus, Plus, Undo2, X } from "lucide-react";
import { alternarUrgente, avanzarCorte, remitoDeLaReposicion, volverCorte } from "./actions";

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
  pedidoId = null,
  sinCargo = false,
}: {
  /**
   * El pedido del corte: terminado, se entrega desde el pedido, con quién
   * retira y el remito, y el pedido queda entregado. «Marcar retirado» acá
   * lo dejaba en Preparando y había que pedir los datos otra vez (mes
   * simulado, M3S4-040).
   */
  pedidoId?: string | null;
  /**
   * La reposición sin cargo: al retirarla se firma su remito, con nombre y
   * documento; salía con un toque y sin constancia (M3S2-026).
   */
  sinCargo?: boolean;
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
        // Los dos botones que aparecen ya lo dicen: sin aviso encima
        // (mes simulado, M3S3-015).
        setSinCobrar(true);
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
      /* En dos renglones: las pasadas arriba y la confirmación abajo, a lo
         ancho. En uno solo, a 375 px «Terminado» quedaba en 24 px contra el
         borde de la tarjeta (mes simulado, H403). */
      <form
        className="grid w-full gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setConfirmando(false);
          avanzar(cuantas);
        }}
      >
        <div className="flex items-center gap-3">
          {/* La cifra que se cobra, como en la ficha: no las pasadas que hizo
              la sierra en todas las placas (mes simulado, M2S4-014). */}
          <label htmlFor={`pasadas-${id}`} className="text-base font-medium leading-tight">
            Pasadas a cobrar
          </label>
          <div className="flex flex-1 items-center justify-between rounded-lg bg-hundida">
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
        </div>
        <div className="flex gap-2">
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

  // Terminado y sin cobrar: dos botones a lo ancho, uno abajo del otro, el
  // de cobrar primero y el peligroso aparte. En un renglón con «Urgente» los
  // textos se pisaban a 375 px (mes simulado, M3S3-015).
  if (etiqueta && sinCobrar && estado === "terminado") {
    return (
      <div className="grid w-full gap-3">
        <Link
          href={`/mostrador?corte=${id}`}
          className={`boton-accion inline-flex ${alto} w-full items-center justify-center gap-1.5 rounded-lg px-3 text-base font-medium`}
        >
          Cobrar en el mostrador
        </Link>
        <button
          onClick={() => avanzar(undefined, true)}
          disabled={pendiente}
          className={`inline-flex ${alto} w-full items-center justify-center gap-1.5 rounded-lg border border-destructive/40 px-3 text-base font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50`}
        >
          {pendiente && <Loader2 className="h-5 w-5 animate-spin" />}
          Entregar sin cobrar
        </button>
      </div>
    );
  }

  if (etiqueta && estado === "terminado" && pedidoId && !sinCargo) {
    return (
      <Link
        href={`/admin/pedidos/${pedidoId}`}
        className={`boton-accion inline-flex ${alto} w-full items-center justify-center gap-1.5 rounded-lg px-3 text-base font-medium`}
      >
        <ArrowRight className="h-5 w-5" />
        Entregar
      </Link>
    );
  }

  if (etiqueta && estado === "terminado" && pedidoId && sinCargo) {
    return (
      <button
        disabled={pendiente}
        onClick={() =>
          startTransition(async () => {
            const r = await avanzarCorte(id, estado);
            if (r.error) {
              toast.error(r.error);
              router.refresh();
              return;
            }
            const remito = await remitoDeLaReposicion(id);
            if (remito.firmaToken) {
              router.push(`/firmar/${remito.firmaToken}?volver=${encodeURIComponent(`/admin/cortes/${id}`)}`);
            } else {
              toast.success(r.ok ?? "Listo.");
              router.refresh();
            }
          })
        }
        className={`boton-accion inline-flex ${alto} w-full items-center justify-center gap-1.5 rounded-lg px-3 text-base font-medium disabled:opacity-50`}
      >
        {pendiente ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowRight className="h-5 w-5" />}
        {etiqueta}
      </button>
    );
  }

  // Urgente es para lo que espera: en un terminado ya no le dice nada al
  // taller (M2S1-149, M3S3-015).
  const puedeUrgente = (estado === "en-cola" || estado === "en-proceso") && !soloMaquina;

  return (
    <div className={`flex items-center gap-2 ${compacto ? "w-full" : ""}`}>
      {puedeUrgente && (
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

      {etiqueta && (
        <button
          onClick={() => {
            if (estado === "en-proceso" && pasadas > 0) {
              setCuantas(pasadas);
              setConfirmando(true);
            } else avanzar();
          }}
          disabled={pendiente}
          className={`boton-accion inline-flex ${alto} items-center justify-center gap-1.5 rounded-lg px-3 text-base font-medium transition-colors disabled:opacity-50 ${compacto ? "min-w-0 flex-1 basis-0" : ""}`}
        >
          {pendiente ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <ArrowRight className="h-5 w-5" />
          )}
          {etiqueta}
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
      // Un botón secundario de verdad, con borde y el alto de «Hoja de
      // corte»: sin borde se leía como un título (mes simulado, M3S2-047).
      className="inline-flex h-12 items-center justify-center gap-1.5 rounded-lg border px-4 text-base font-medium transition-colors hover:bg-muted disabled:opacity-50"
    >
      {pendiente ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
      {texto}
    </button>
  );
}
