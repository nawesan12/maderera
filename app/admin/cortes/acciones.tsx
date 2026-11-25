"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Flame, Loader2 } from "lucide-react";
import { alternarUrgente, avanzarCorte } from "./actions";

const SIGUIENTE: Record<string, string> = {
  "en-cola": "Empezar",
  "en-proceso": "Marcar terminado",
  terminado: "Marcar retirado",
};

export function AccionesCorte({
  id,
  estado,
  urgente,
  compacto = false,
  soloMaquina = false,
}: {
  id: string;
  estado: string;
  urgente: boolean;
  compacto?: boolean;
  /**
   * En el taller, el aserradero empieza y termina. Marcar urgente y entregar
   * son decisiones del mostrador.
   */
  soloMaquina?: boolean;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();

  function accion(fn: () => Promise<{ ok?: string; error?: string }>) {
    startTransition(async () => {
      const resultado = await fn();
      if (resultado.error) toast.error(resultado.error);
      else toast.success(resultado.ok ?? "Listo.");
      // También con error: si fue un 409 («ya estaba en la máquina»), la
      // pantalla tiene que mostrar el estado de verdad.
      router.refresh();
    });
  }

  const etiqueta = soloMaquina && estado === "terminado" ? undefined : SIGUIENTE[estado];

  return (
    <div className={`flex items-center gap-2 ${compacto ? "w-full" : ""}`}>
      {estado !== "retirado" && !soloMaquina && (
        <button
          onClick={() => accion(() => alternarUrgente(id))}
          disabled={pendiente}
          aria-pressed={urgente}
          title={urgente ? "Quitar la urgencia" : "Marcar como urgente"}
          className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-lg px-3 text-base font-medium transition-colors disabled:opacity-50 ${
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
          onClick={() => accion(() => avanzarCorte(id, estado))}
          disabled={pendiente}
          className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-lg boton-accion px-3 text-base font-medium transition-colors disabled:opacity-50 ${compacto ? "min-w-0 flex-1 basis-0" : ""}`}
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
