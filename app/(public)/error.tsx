"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCcw, TriangleAlert } from "lucide-react";

/**
 * Algo se rompió en una página pública.
 *
 * No dice qué falló: a quien está comprando no le sirve un stack trace, y el
 * mensaje de un error de base de datos puede filtrar nombres de tablas. El
 * detalle va a la consola del servidor, que es donde se mira.
 *
 * El `digest` sí se muestra: es el identificador que Next le pone al error, y
 * es lo único que permite encontrar *este* error en los registros cuando
 * alguien llama para contarlo.
 */
export default function ErrorPublico({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Error en una página pública:", error);
  }, [error]);

  return (
    <div className="contenedor flex min-h-[60vh] flex-col items-center justify-center py-16 text-center">
      {/* Una pantalla de error se sirve con 200: el documento ya empezó a
          salir cuando aparece la falla, así que el límite de error se pinta del
          lado del cliente sobre la silueta de carga. Sin esto, un buscador que
          pase durante una caída se queda con esta página como buena.

          React sube la etiqueta al `head` al pintarse, y ante dos `robots`
          gana la más restrictiva, así que este `noindex` le gana al `index,
          follow` de la página. Comprobado en el navegador.

          El alcance es ese y no más: quien no ejecute JavaScript recibe el HTML
          con la silueta de carga y el `index, follow`. Google sí lo ejecuta. */}
      <meta name="robots" content="noindex, nofollow" />

      <span className="flex h-16 w-16 items-center justify-center rounded-[18px] bg-naranja-claro text-acento-sobre-claro">
        <TriangleAlert className="h-8 w-8" />
      </span>

      <h1 className="mt-6 text-[28px] font-bold tracking-[-0.03em]">
        Se nos rompió algo
      </h1>
      <p className="mt-2 max-w-md text-base text-texto-2">
        No es culpa tuya. Probá de nuevo; si sigue pasando, escribinos y lo
        miramos.
      </p>

      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <button
          onClick={reset}
          className="flex h-12 items-center gap-2 rounded-[10px] bg-accion px-6 text-[15px] font-semibold text-white transition-colors hover:bg-accion-hover"
        >
          <RotateCcw className="h-4 w-4" />
          Probar de nuevo
        </button>
        <Link
          href="/"
          className="flex h-12 items-center rounded-[10px] border border-linea px-6 text-[15px] font-semibold transition-colors hover:bg-sitio-alt"
        >
          Ir al inicio
        </Link>
      </div>

      {error.digest && (
        <p className="tabular mt-8 text-xs text-texto-3">
          Si nos escribís, pasanos este código: {error.digest}
        </p>
      )}
    </div>
  );
}
