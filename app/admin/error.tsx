"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCcw, TriangleAlert } from "lucide-react";

/**
 * Algo se rompió en el panel.
 *
 * A diferencia del error del sitio, acá el `digest` va en primer plano: quien
 * lo ve trabaja en la empresa y va a avisar, y ese código es lo que permite
 * encontrar el error exacto en los registros del servidor en vez de adivinar
 * cuál de los de esa tarde fue.
 */
export default function ErrorPanel({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Error en el panel:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="tarjeta max-w-lg p-8 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-[14px] bg-naranja-claro text-acento-sobre-claro">
          <TriangleAlert className="h-7 w-7" />
        </span>

        <h1 className="mt-5 text-2xl font-semibold tracking-tight">
          Esta pantalla no cargó
        </h1>
        <p className="mt-2 text-base text-texto-2">
          El resto del panel sigue andando. Probá de nuevo; si vuelve a pasar,
          pasale el código de abajo a quien lo mantiene.
        </p>

        {error.digest && (
          <p className="tabular mt-4 rounded-lg bg-hundida px-3 py-2 text-sm">
            {error.digest}
          </p>
        )}

        <div className="mt-6 flex flex-wrap justify-center gap-2.5">
          <button
            onClick={reset}
            className="boton-accion flex h-11 items-center gap-2 rounded-lg px-5 text-base font-medium"
          >
            <RotateCcw className="h-4 w-4" />
            Probar de nuevo
          </button>
          <Link
            href="/admin"
            className="flex h-11 items-center rounded-lg border border-linea px-5 text-base font-medium transition-colors hover:bg-hundida"
          >
            Ir al resumen
          </Link>
        </div>
      </div>
    </div>
  );
}
