"use client";

import { Smartphone, Wallet } from "lucide-react";

/**
 * Lo que aparece cuando se pasó el tope de gasto del mes y alguien quiere
 * mandar igual por la API.
 *
 * No se bloquea en silencio: puede ser algo que tiene que salir sí o sí. Pero
 * se pregunta, y al lado se ofrece lo gratis —contestar desde la app del
 * teléfono—. Va **adentro del formulario** que se quiso mandar: el botón es un
 * submit con `confirmarTope=si`, así lo escrito, la plantilla o el documento
 * elegido viajan igual que la primera vez.
 */
export function ConfirmarTope({
  gratis,
  armar,
}: {
  gratis?: string | null;
  /** Arma el enlace al tocarlo, con lo que haya escrito en ese momento. */
  armar?: () => string | null;
}) {
  return (
    <div className="estado-espera mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--estado-fondo)] px-3 py-2 text-[var(--estado-tinta)]">
      {gratis && (
        <a
          href={gratis}
          onClick={(e) => {
            const enlace = armar?.();
            if (enlace) e.currentTarget.href = enlace;
          }}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-verde-whatsapp px-3 text-base font-medium text-white hover:bg-brand-green/90"
        >
          <Smartphone className="h-4 w-4" />
          Contestar desde el teléfono (gratis)
        </a>
      )}
      <button
        type="submit"
        name="confirmarTope"
        value="si"
        className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-current/30 bg-background px-3 text-base font-medium text-foreground hover:bg-muted"
      >
        <Wallet className="h-4 w-4" />
        Mandar igual por la API (se cobra)
      </button>
    </div>
  );
}
