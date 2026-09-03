"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send, Truck } from "lucide-react";
import {
  anularOrdenDeCompra,
  marcarOrdenEnviada,
  recibirDeLaOrden,
  type EstadoOrden,
} from "../actions";

/**
 * Lo que se puede hacer con una orden.
 *
 * "Recibir el remito" arma una recepción en borrador **con lo que falta ya
 * cargado**: el camión llega y lo que hay que hacer es confirmar cantidades, no
 * volver a buscar cada producto. Quien recibe corrige lo que vino de menos, y
 * la orden queda parcial sola.
 */
export function AccionesDeOrden({
  id,
  estado,
  falta,
}: {
  id: string;
  estado: string;
  falta: boolean;
}) {
  const router = useRouter();
  const [resultado, setResultado] = useState<EstadoOrden>({});
  const [enCurso, empezar] = useTransition();
  const [remito, setRemito] = useState("");
  const [motivo, setMotivo] = useState("");

  if (estado === "anulada") return null;

  const recibible = (estado === "enviada" || estado === "parcial") && falta;

  return (
    <section className="tarjeta space-y-3 p-5">
      {(resultado.error || resultado.ok) && (
        <p
          className={`text-base ${resultado.error ? "text-saldo-debe" : "text-saldo-favor"}`}
        >
          {resultado.error ?? resultado.ok}
        </p>
      )}

      {estado === "borrador" && (
        <button
          type="button"
          onClick={() =>
            empezar(async () => {
              const r = await marcarOrdenEnviada(id);
              setResultado(r);
              if (r.ok) router.refresh();
            })
          }
          disabled={enCurso}
          className="inline-flex h-12 items-center gap-2 rounded-xl bg-accion px-5 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {enCurso ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Marcar como enviada al proveedor
        </button>
      )}

      {recibible && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1">
            <span className="text-sm font-medium">Número de remito</span>
            <input
              value={remito}
              onChange={(e) => setRemito(e.target.value)}
              placeholder="0002-00034512"
              className="tabular mt-1 h-12 w-full rounded-lg border border-linea bg-background px-3 text-base"
            />
          </label>
          <button
            type="button"
            onClick={() =>
              empezar(async () => {
                const r = await recibirDeLaOrden(id, remito);
                setResultado(r);
                if (r.id) router.push(`/admin/recepciones/${r.id}`);
              })
            }
            disabled={enCurso}
            className="inline-flex h-12 shrink-0 items-center gap-2 rounded-xl bg-accion px-5 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {enCurso ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Truck className="h-4 w-4" />
            )}
            Recibir el remito
          </button>
        </div>
      )}

      <details className="border-t border-linea pt-3">
        <summary className="cursor-pointer text-base text-muted-foreground">
          Anular esta orden
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
                const r = await anularOrdenDeCompra(id, motivo);
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
          Lo ya recibido no se toca: la mercadería está en el depósito. Anular
          solo saca de &quot;en camino&quot; lo que falta.
        </p>
      </details>
    </section>
  );
}
