"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import {
  anularRecepcion,
  confirmarRecepcion,
  type EstadoRecepcion,
} from "../actions";

/**
 * Confirmar y anular.
 *
 * Confirmar pide un segundo clic porque mueve el costo promedio y eso no se
 * puede deshacer: anular después saca el stock y **deja el costo como quedó**.
 * Un botón que hace algo irreversible tiene que costar más que un botón que no.
 */
export function AccionesDeRecepcion({
  id,
  estado,
}: {
  id: string;
  estado: string;
}) {
  const router = useRouter();
  const [resultado, setResultado] = useState<EstadoRecepcion>({});
  const [enCurso, empezar] = useTransition();
  const [seguro, setSeguro] = useState(false);
  const [motivo, setMotivo] = useState("");

  if (estado === "anulada") return null;

  return (
    <section className="tarjeta space-y-3 p-5">
      {(resultado.error || resultado.ok) && (
        <p
          className={`text-base ${resultado.error ? "text-saldo-debe" : "text-saldo-favor"}`}
        >
          {resultado.error ?? resultado.ok}
        </p>
      )}

      {estado === "borrador" ? (
        seguro ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-base">
              Entra el stock, se mezcla el costo promedio y sube la deuda.{" "}
              <strong>El costo no se puede revertir.</strong>
            </p>
            <button
              type="button"
              onClick={() =>
                empezar(async () => {
                  const r = await confirmarRecepcion(id);
                  setResultado(r);
                  setSeguro(false);
                  if (r.ok) router.refresh();
                })
              }
              disabled={enCurso}
              className="inline-flex h-12 shrink-0 items-center gap-2 rounded-xl bg-accion px-5 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {enCurso ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Sí, confirmar
            </button>
            <button
              type="button"
              onClick={() => setSeguro(false)}
              className="h-12 shrink-0 rounded-xl border border-linea px-4 text-base"
            >
              Mejor no
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setSeguro(true)}
            className="inline-flex h-12 items-center gap-2 rounded-xl bg-accion px-5 text-base font-semibold text-white transition-opacity hover:opacity-90"
          >
            <Check className="h-4 w-4" />
            Confirmar la recepción
          </button>
        )
      ) : null}

      <details className="border-t border-linea pt-3">
        <summary className="cursor-pointer text-base text-muted-foreground">
          Anular esta recepción
        </summary>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo"
            className="h-11 min-w-0 flex-1 rounded-lg border border-linea bg-background px-3 text-base"
          />
          <button
            type="button"
            onClick={() =>
              empezar(async () => {
                const r = await anularRecepcion(id, motivo);
                setResultado(r);
                if (r.ok) router.refresh();
              })
            }
            disabled={enCurso || !motivo.trim()}
            className="h-11 shrink-0 rounded-lg border border-linea px-4 text-base font-medium disabled:opacity-50"
          >
            Anular
          </button>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          El stock vuelve atrás y la deuda se acredita. El costo promedio queda
          como quedó: revertir la mezcla exigiría recalcular todas las
          recepciones posteriores de esa mercadería.
        </p>
      </details>
    </section>
  );
}
