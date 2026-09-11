import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * Encabezado de una ficha del panel: la pantalla de *una* cosa.
 *
 * `EncabezadoPanel` sirve para los listados, donde alcanza con título y
 * detalle. Una ficha necesita tres cosas más y las veintiséis que existían las
 * reinventaban con treinta líneas de flexbox cada una: de dónde se vino
 * (porque a una ficha se entra desde una lista, desde un buscador o desde otra
 * ficha, y el botón atrás del navegador no siempre es lo que uno quiere), en
 * qué estado está la cosa, y qué se puede hacer con ella.
 *
 * El estado va **al lado del título y no debajo**: es lo que decide si las
 * acciones de la derecha tienen sentido, así que se lee en el mismo golpe de
 * vista.
 */
export function EncabezadoFicha({
  volverA,
  volverTexto,
  titulo,
  detalle,
  estado,
  acciones,
}: {
  volverA: string;
  /** "Volver a pedidos". Se escribe entero para que se lea como una frase. */
  volverTexto: string;
  titulo: string;
  /** El número, la fecha, la empresa: lo que identifica a esta y no a otra. */
  detalle?: React.ReactNode;
  /** Etiquetas de estado. Van pegadas al título. */
  estado?: React.ReactNode;
  acciones?: React.ReactNode;
}) {
  return (
    <div className="mb-6 space-y-4">
      <Link
        href={volverA}
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        {volverTexto}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
            {estado}
          </div>
          {detalle && (
            <p className="mt-0.5 text-base text-muted-foreground">{detalle}</p>
          )}
        </div>

        {acciones && (
          <div className="flex flex-wrap items-start gap-2">{acciones}</div>
        )}
      </div>
    </div>
  );
}
