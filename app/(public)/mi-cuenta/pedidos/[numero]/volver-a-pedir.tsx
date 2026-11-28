"use client";

import { useActionState, useState } from "react";
import { AlertCircle, Loader2, RotateCcw } from "lucide-react";
import { repetirPedido, type EstadoAccion } from "../../actions";

const estadoInicial: EstadoAccion = {};

/**
 * Carga en el carrito lo mismo que tenía este pedido y lleva al carrito.
 * Con algo ya en el carrito, el primer toque pregunta: reemplazarlo o sumar
 * (M2S4-015).
 */
export function VolverAPedir({ numero, carritoConCosas }: { numero: string; carritoConCosas: boolean }) {
  const [estado, accion, pendiente] = useActionState(
    repetirPedido,
    estadoInicial,
  );
  const [eligiendo, setEligiendo] = useState(false);
  const icono = pendiente ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />;
  const boton =
    "inline-flex h-11 items-center gap-2 rounded-lg border bg-card px-4 font-medium transition-colors hover:bg-muted disabled:opacity-60";

  return (
    <form action={accion}>
      <input type="hidden" name="numero" value={numero} />
      {carritoConCosas && eligiendo ? (
        <div className="flex flex-wrap gap-2">
          <button type="submit" name="modo" value="reemplazar" disabled={pendiente} className={boton}>
            {icono}
            Reemplazar el carrito
          </button>
          <button type="submit" name="modo" value="sumar" disabled={pendiente} className={boton}>
            Sumar al carrito
          </button>
        </div>
      ) : (
        <button
          type={carritoConCosas ? "button" : "submit"}
          onClick={carritoConCosas ? () => setEligiendo(true) : undefined}
          disabled={pendiente}
          className={boton}
        >
          {icono}
          Volver a pedir lo mismo
        </button>
      )}

      {estado.error && (
        <p
          role="alert"
          className="mt-2 flex items-center gap-2 text-sm text-brand-red"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          {estado.error}
        </p>
      )}
    </form>
  );
}
