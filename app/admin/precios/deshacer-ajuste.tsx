"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import { Confirmar } from "@/components/admin/confirmar";
import { deshacerUltimoAjuste } from "./actions";

/**
 * Deshacer el último ajuste masivo. Un porcentaje mal tipeado (100 en vez de
 * 10) cambiaba miles de precios sin vuelta atrás; ahora vuelven al anterior,
 * salvo los que alguien corrigió a mano después.
 */
export function DeshacerAjuste({
  cuando,
  motivo,
  deshacibles,
}: {
  cuando: string;
  motivo: string | null;
  deshacibles: number;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [pendiente, empezar] = useTransition();

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
      >
        <Undo2 className="h-5 w-5" />
        Deshacer el último ajuste
      </button>
      <Confirmar
        abierto={abierto}
        alCerrar={() => setAbierto(false)}
        titulo={`Deshacer ${motivo ? `«${motivo}»` : "el ajuste"} del ${cuando}`}
        detalle={`${deshacibles} ${deshacibles === 1 ? "precio vuelve" : "precios vuelven"} al que tenían antes. Los que se corrigieron a mano después quedan como están.`}
        confirmar="Deshacer"
        pendiente={pendiente}
        alConfirmar={() =>
          empezar(async () => {
            const r = await deshacerUltimoAjuste();
            if (r.error) toast.error(r.error);
            else toast.success(r.ok ?? "Listo.");
            setAbierto(false);
            router.refresh();
          })
        }
      />
    </>
  );
}
