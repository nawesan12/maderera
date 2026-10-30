"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { anularPago } from "./actions";

/**
 * Anular un pago a proveedor cargado por error.
 *
 * Va escondido detrás de un desplegable y pide el motivo: deshace plata ya
 * pagada y certificados de retención que el proveedor quizás ya tiene. Lo que
 * hace está dicho antes de apretar, porque toca cuatro lugares a la vez.
 */
export function AnularPago({
  id,
  supplierId,
}: {
  id: string;
  supplierId: string;
}) {
  const router = useRouter();
  const [motivo, setMotivo] = useState("");
  const [resultado, setResultado] = useState<{ error?: string; ok?: string }>(
    {},
  );
  const [enCurso, empezar] = useTransition();

  return (
    <details className="mt-1 text-sm">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
        Anular
      </summary>
      <div className="mt-2 w-72 space-y-2 text-left">
        <p className="text-muted-foreground">
          La deuda vuelve a la cuenta del proveedor, las facturas quedan otra
          vez con saldo, los certificados de retención se anulan, los cheques
          endosados vuelven a la cartera y los propios se anulan.
        </p>
        <input
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Motivo"
          className="h-10 w-full rounded-lg border border-linea bg-background px-3 text-base"
        />
        <button
          type="button"
          onClick={() =>
            empezar(async () => {
              const r = await anularPago(id, supplierId, motivo);
              setResultado(r);
              if (r.ok) router.refresh();
            })
          }
          disabled={enCurso || motivo.trim() === ""}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-saldo-debe px-3.5 text-sm font-medium text-saldo-debe hover:bg-hundida disabled:opacity-50"
        >
          {enCurso && <Loader2 className="h-4 w-4 animate-spin" />}
          Anular el pago
        </button>
        {(resultado.error || resultado.ok) && (
          <p className={resultado.error ? "text-saldo-debe" : "text-saldo-favor"}>
            {resultado.error ?? resultado.ok}
          </p>
        )}
      </div>
    </details>
  );
}
