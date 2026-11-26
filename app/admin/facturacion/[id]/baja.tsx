"use client";

import { useActionState, useState } from "react";
import { AlertCircle, ArrowRight, Loader2, Trash2 } from "lucide-react";
import { darDeBaja, type EstadoFactura } from "../actions";
import { formatearMonto } from "@/lib/formato";
import { numeroFormateado } from "@/lib/fiscal/comprobantes";

const inicial: EstadoFactura = {};

interface Corrimiento {
  invoiceId: string;
  de: number;
  a: number;
  receptorNombre: string;
}

/**
 * Dar de baja un comprobante que ARCA no autorizó.
 *
 * Es la salida de una serie trabada, y es irreversible: el número queda
 * libre y el último pendiente de la serie pasa a ocuparlo (los demás no
 * cambian de número). Por eso va plegado,
 * como acción secundaria debajo de reintentar y corregir, y antes de
 * confirmar muestra lo que se corre y a quién (el que tenía el PDF del 0005
 * ahora tiene el 0004) y la deuda que se va con él. La lista viaja con el
 * formulario: si mientras se escribe el motivo entra otro comprobante en la
 * serie, Go no corre a nadie que no se vio. Si Go dice que no se puede, se
 * muestra el porqué en vez del formulario.
 */
export function DarDeBaja({
  id,
  puntoVenta,
  numero,
  corren,
  deuda,
  receptor,
  bloqueo,
}: {
  id: string;
  puntoVenta: number;
  numero: number;
  corren: Corrimiento[];
  deuda: number;
  receptor: string;
  bloqueo: string | null;
}) {
  const [estado, accion, pendiente] = useActionState(darDeBaja, inicial);
  const [abierto, setAbierto] = useState(false);
  const propio = numeroFormateado(puntoVenta, numero);

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-base font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 className="h-5 w-5" />
        Dar de baja
      </button>
    );
  }

  const cerrar = () => setAbierto(false);

  if (bloqueo) {
    return (
      <div className="space-y-2.5 rounded-xl border bg-background p-4">
        <p
          role="alert"
          className="estado-problema flex items-start gap-2 rounded-lg bg-[var(--estado-fondo)] px-3 py-2 text-base text-[var(--estado-tinta)]"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          {bloqueo}
        </p>
        <button
          type="button"
          onClick={cerrar}
          autoFocus
          className="inline-flex h-10 items-center rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
        >
          Cerrar
        </button>
      </div>
    );
  }

  return (
    <form
      action={accion}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !pendiente) cerrar();
      }}
      className="space-y-3 rounded-xl border bg-background p-4"
    >
      <input type="hidden" name="id" value={id} />
      {corren.map((c) => (
        <input key={c.invoiceId} type="hidden" name="corren" value={c.invoiceId} />
      ))}

      <p className="text-base font-medium">Libera el {propio}</p>

      {corren.length > 0 && (
        <ul className="divide-y rounded-lg bg-hundida text-base">
          {corren.map((c) => (
            <li key={c.invoiceId} className="flex flex-wrap items-center gap-x-2 px-3 py-2">
              <span className="w-full font-medium">{c.receptorNombre}</span>
              <span className="codigo text-muted-foreground line-through">
                {numeroFormateado(puntoVenta, c.de)}
              </span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" aria-label="pasa a" />
              <span className="codigo font-medium">{numeroFormateado(puntoVenta, c.a)}</span>
            </li>
          ))}
        </ul>
      )}

      {deuda > 0 && (
        <p className="text-base">
          Sale <span className="tabular font-medium">{formatearMonto(deuda)}</span> de la cuenta
          corriente de {receptor}.
        </p>
      )}
      {deuda < 0 && (
        <p className="text-base">
          {receptor} vuelve a deber{" "}
          <span className="tabular font-medium">{formatearMonto(-deuda)}</span>.
        </p>
      )}

      <input
        name="motivo"
        required
        minLength={4}
        maxLength={300}
        autoFocus
        placeholder="Motivo de la baja"
        className="h-10 w-full rounded-lg border bg-background px-3 text-base"
      />

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pendiente}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-destructive px-4 text-base font-medium text-white transition-colors hover:bg-destructive/90 disabled:opacity-60"
        >
          {pendiente && <Loader2 className="h-5 w-5 animate-spin" />}
          {`Liberar el ${propio}`}
        </button>
        <button
          type="button"
          onClick={cerrar}
          disabled={pendiente}
          className="inline-flex h-10 items-center rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
        >
          Cancelar
        </button>
      </div>

      {estado.error && (
        <p
          role="alert"
          className="estado-problema flex items-start gap-2 rounded-lg bg-[var(--estado-fondo)] px-3 py-2 text-base text-[var(--estado-tinta)]"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          {estado.error}
        </p>
      )}
    </form>
  );
}
