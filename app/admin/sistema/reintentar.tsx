"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { reintentarTrabajo } from "./actions";

export function Reintentar({ id }: { id: string }) {
  const router = useRouter();
  const [pendiente, empezar] = useTransition();
  return (
    <button
      type="button"
      disabled={pendiente}
      onClick={() =>
        empezar(async () => {
          const r = await reintentarTrabajo(id);
          if (r.error) toast.error(r.error);
          else toast.success(r.ok ?? "Vuelve a la cola.");
          router.refresh();
        })
      }
      className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border bg-card px-3 text-base font-medium hover:bg-hundida disabled:opacity-60"
    >
      {pendiente ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
      Reintentar
    </button>
  );
}
