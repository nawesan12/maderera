"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

/**
 * Registra el ayudante que hace que el mostrador abra sin internet.
 *
 * **En desarrollo no se registra**, a propósito: el caché pelea con la recarga
 * en caliente y termina sirviendo una versión vieja mientras uno jura que
 * cambió el código.
 *
 * Cuando hay una versión nueva **no se recarga sola**. Se avisa y se espera:
 * recargar la página en medio de un cobro, con las líneas cargadas y el cliente
 * enfrente, es peor que seguir un rato con la versión anterior.
 */
export function RegistroDelAyudante() {
  const [hayVersionNueva, setHayVersionNueva] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let vivo = true;

    void navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((registro) => {
        registro.addEventListener("updatefound", () => {
          const nuevo = registro.installing;
          if (!nuevo) return;

          nuevo.addEventListener("statechange", () => {
            // "installed" con un worker ya controlando significa: hay una
            // versión nueva esperando a que alguien recargue.
            if (nuevo.state === "installed" && navigator.serviceWorker.controller && vivo) {
              setHayVersionNueva(true);
            }
          });
        });
      })
      .catch(() => {
        // Que no se pueda registrar no rompe nada: el mostrador sigue andando
        // con internet, que es como andaba antes.
      });

    return () => {
      vivo = false;
    };
  }, []);

  if (!hayVersionNueva) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-linea bg-card px-4 py-2.5 shadow-lg">
      <RefreshCw className="h-4 w-4 text-acento-texto" />
      <span className="text-sm">Hay una versión nueva.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-full bg-accion px-3 py-1 text-sm font-semibold text-white"
      >
        Recargar
      </button>
    </div>
  );
}
