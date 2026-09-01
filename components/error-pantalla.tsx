"use client";

import { useEffect } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";

/**
 * Pantalla de error para las vistas de pantalla completa del local: el
 * mostrador y el taller.
 *
 * Son distintas del sitio y del panel porque quien las mira está parado frente
 * a un cliente o al lado de una máquina: no hay menú al que volver ni otra
 * pantalla que sirva. Lo único útil es reintentar, en letra grande y con un
 * botón que se pueda tocar con la mano sucia.
 *
 * El código del error se muestra igual: es lo único que permite encontrar
 * *este* error en los registros cuando alguien del taller llama para contarlo.
 */
export function ErrorDePantalla({
  error,
  reset,
  donde,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  donde: string;
}) {
  useEffect(() => {
    console.error(`Error en ${donde}:`, error);
  }, [error, donde]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-8 text-center text-foreground">
      <span className="estado-problema flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--estado-fondo)] text-[var(--estado-tinta)]">
        <TriangleAlert className="h-8 w-8" />
      </span>

      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          No se pudo cargar la pantalla
        </h1>
        <p className="mt-2 text-lg text-muted-foreground">
          Probá de nuevo. Si sigue igual, avisá en el mostrador.
        </p>
      </div>

      <button
        onClick={reset}
        className="inline-flex h-14 items-center gap-2.5 rounded-xl bg-accion px-8 text-lg font-semibold text-white transition-colors hover:bg-accion-hover"
      >
        <RotateCcw className="h-5 w-5" />
        Probar de nuevo
      </button>

      {error.digest && (
        <p className="text-sm text-muted-foreground">Código: {error.digest}</p>
      )}
    </div>
  );
}
