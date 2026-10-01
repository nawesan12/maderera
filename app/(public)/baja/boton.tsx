"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { confirmarBaja } from "./actions";

export function BotonDeBaja({ e, t, dadoDeBaja }: { e: string; t: string; dadoDeBaja: boolean }) {
  const [baja, setBaja] = useState(dadoDeBaja);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, empezar] = useTransition();

  function cambiar(recibir: boolean) {
    empezar(async () => {
      const r = await confirmarBaja(e, t, recibir);
      if (r.error) setError(r.error);
      else setBaja(!recibir);
    });
  }

  return (
    <div className="mt-6" aria-live="polite">
      {baja ? (
        <>
          <p className="text-lg font-medium">Listo: no te vamos a mandar más novedades.</p>
          <p className="mt-1 text-texto-2">Los avisos de tus pedidos y tus recibos te van a seguir llegando.</p>
          <button type="button" onClick={() => cambiar(true)} disabled={pendiente} className="mt-5 text-base font-medium text-acento-texto underline-offset-4 hover:underline disabled:opacity-60">
            Me equivoqué, quiero seguir recibiéndolas
          </button>
        </>
      ) : (
        <>
          <p className="mb-5 text-texto-2">
            Si te das de baja, no te mandamos más promociones ni novedades. Los avisos de tus
            pedidos y tus recibos te siguen llegando.
          </p>
          <button
            type="button"
            onClick={() => cambiar(false)}
            disabled={pendiente}
            className="inline-flex h-12 items-center gap-2 rounded-full bg-brand-orange px-6 text-base font-semibold text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
          >
            {pendiente && <Loader2 className="h-5 w-5 animate-spin" />}
            Darme de baja
          </button>
        </>
      )}
      {error && <p role="alert" className="estado-problema mt-3 font-medium">{error}</p>}
    </div>
  );
}
