"use client";

import { useActionState } from "react";
import { AlertCircle, Check, Link2, Loader2 } from "lucide-react";
import { vincularCuentaWeb, type EstadoCliente } from "../actions";

const estadoInicial: EstadoCliente = {};

/**
 * Aviso de que esta persona se registró en el sitio con otra ficha.
 *
 * Va con borde de acento porque pide una decisión, y dice explícitamente qué
 * pasa al confirmar: unir cuentas corrientes no es reversible con un botón, así
 * que quien lo aprieta tiene que saber qué se mueve.
 */
export function AvisoCuentaWeb({
  customerId,
  cuentaWeb,
  nombreCliente,
}: {
  customerId: string;
  cuentaWeb: { id: string; nombre: string };
  nombreCliente: string;
}) {
  const [estado, accion, pendiente] = useActionState(
    vincularCuentaWeb,
    estadoInicial,
  );

  if (estado.ok) {
    return (
      <section className="flex items-center gap-2 rounded-xl bg-green-50 px-5 py-4 text-base text-green-900">
        <Check className="h-5 w-5 shrink-0" />
        {estado.ok}
      </section>
    );
  }

  return (
    <section className="tarjeta-atencion p-5">
      <h2 className="flex items-center gap-2 text-base font-medium">
        <Link2 className="h-5 w-5 text-brand-orange" />
        Se registró en el sitio
      </h2>
      <p className="mt-1.5 text-base text-muted-foreground">
        Hay una cuenta web a nombre de{" "}
        <span className="font-medium text-foreground">{cuentaWeb.nombre}</span>{" "}
        con el mismo correo. Si es la misma persona, al vincularla va a poder ver
        los pedidos, presupuestos y la cuenta corriente de{" "}
        <span className="font-medium text-foreground">{nombreCliente}</span>{" "}
        desde el sitio.
      </p>

      <form action={accion} className="mt-4">
        <input type="hidden" name="customerId" value={customerId} />
        <input type="hidden" name="cuentaWebId" value={cuentaWeb.id} />
        <button
          type="submit"
          disabled={pendiente}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-orange px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
        >
          {pendiente ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Link2 className="h-5 w-5" />
          )}
          Es la misma persona, vincular
        </button>
      </form>

      {estado.error && (
        <p
          role="alert"
          className="mt-2.5 flex items-center gap-2 text-base text-red-700"
        >
          <AlertCircle className="h-5 w-5 shrink-0" />
          {estado.error}
        </p>
      )}
    </section>
  );
}
