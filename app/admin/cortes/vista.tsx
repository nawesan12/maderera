import Link from "next/link";
import { Flame, ListChecks, Scissors } from "lucide-react";
import {
  ColumnaTablero,
  TarjetaTablero,
  Tablero,
} from "@/components/admin/kanban";
import { haceCuanto } from "@/components/admin/formato";
import type { CorteListado } from "@/lib/dal/admin/cortes";
import { AccionesCorte } from "./acciones";
import { AvisarPorWhatsapp } from "@/components/admin/avisar-por-whatsapp";
import type { AvisoManualListo } from "@/lib/whatsapp/aviso-manual-datos";

/**
 * La cola de corte.
 *
 * Vive acá y no en la página porque la usan dos pantallas: `/admin/cortes`,
 * dentro del panel, y `/taller`, que es la misma cola sola en la pantalla del
 * aserradero. Duplicarla habría hecho que las dos se separaran en el primer
 * cambio, que es justo lo que no se quiere en la pantalla que decide qué se
 * corta primero.
 */
const COLUMNAS = [
  { estado: "en-cola", titulo: "En cola", vacio: "Nada esperando." },
  { estado: "en-proceso", titulo: "En la máquina", vacio: "La máquina está libre." },
  { estado: "terminado", titulo: "Terminados", vacio: "Nada terminado." },
  { estado: "retirado", titulo: "Retirados", vacio: "Nada retirado hoy." },
] as const;

export function TableroDeCortes({
  cortes,
  avisos = {},
}: {
  cortes: CorteListado[];
  /** El aviso gratis de «corte terminado», por id de corte. */
  avisos?: Record<string, AvisoManualListo>;
}) {
  return (
    <>
    {cortes.length === 0 ? (
      <div className="mt-6 rounded-xl border border-dashed py-16 text-center">
        <Scissors className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <p className="text-base font-medium">La cola está vacía</p>
        <p className="mt-1 text-base text-muted-foreground">
          No hay trabajos de corte cargados.
        </p>
      </div>
    ) : (
      <Tablero>
        {COLUMNAS.map((columna) => {
          const enColumna = cortes.filter((c) => c.estado === columna.estado);
          const metros = enColumna.reduce((s, c) => s + c.metrosCuadrados, 0);

          return (
            <ColumnaTablero
              key={columna.estado}
              titulo={columna.titulo}
              cantidad={enColumna.length}
              detalle={
                enColumna.length > 0 ? `${Math.round(metros)} m²` : undefined
              }
              estado={columna.estado}
              vacio={columna.vacio}
            >
              {enColumna.map((corte, i) => (
                <TarjetaCorte
                  key={corte.id}
                  corte={corte}
                  posicion={columna.estado === "en-cola" ? i + 1 : undefined}
                  aviso={avisos[corte.id] ?? null}
                />
              ))}
            </ColumnaTablero>
          );
        })}
      </Tablero>
    )}
    </>
  );
}

function TarjetaCorte({
  corte,
  posicion,
  aviso,
}: {
  corte: CorteListado;
  posicion?: number;
  aviso: AvisoManualListo | null;
}) {
  return (
    <TarjetaTablero destacada={corte.urgente}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {posicion !== undefined && (
            <span
              className="tabular flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-medium text-muted-foreground"
              aria-label={`Puesto ${posicion} en la cola`}
            >
              {posicion}
            </span>
          )}
          <Link
            href={`/admin/cortes/${corte.id}`}
            className="truncate text-base font-medium hover:text-brand-orange"
          >
            {corte.cliente}
          </Link>
        </div>
        <span className="tabular shrink-0 text-sm text-muted-foreground">
          {corte.numero}
        </span>
      </div>

      {corte.urgente && (
        <p className="mt-1.5 inline-flex self-start items-center gap-1 rounded-full bg-brand-orange/15 px-2 py-0.5 text-sm font-medium text-brand-orange-dark">
          <Flame className="h-3.5 w-3.5" />
          Urgente
        </p>
      )}

      <p className="mt-2 text-base">{corte.material}</p>

      {/* Las tres cifras que define el trabajo del operario. */}
      <dl className="mt-2.5 grid grid-cols-3 gap-2 rounded-md bg-muted/60 px-2.5 py-2">
        <Cifra valor={corte.placas} etiqueta={corte.placas === 1 ? "placa" : "placas"} />
        <Cifra valor={corte.piezas} etiqueta={corte.piezas === 1 ? "pieza" : "piezas"} />
        <Cifra valor={corte.metrosCuadrados} etiqueta="m²" />
      </dl>

      {corte.notas && (
        <p className="mt-2 text-sm text-muted-foreground">{corte.notas}</p>
      )}

      <p className="mt-2 text-sm text-muted-foreground">
        {corte.sucursal} · {haceCuanto(corte.createdAt)}
      </p>

      {aviso && (
        <div className="mt-3">
          <AvisarPorWhatsapp aviso={aviso} compacto />
        </div>
      )}

      {/* La hoja de la seccionadora, a un toque desde la tarjeta: en /taller
          es lo primero que se abre antes de cargar la placa. */}
      {corte.piezas > 0 && (
        <Link
          href={`/hoja-de-corte/${corte.id}`}
          target="_blank"
          className="mt-2.5 inline-flex h-10 items-center gap-1.5 self-start rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
        >
          <ListChecks className="h-4 w-4" />
          Hoja de corte
        </Link>
      )}

      <div className="mt-auto border-t pt-3">
        <AccionesCorte
          id={corte.id}
          estado={corte.estado}
          urgente={corte.urgente}
          compacto
        />
      </div>
    </TarjetaTablero>
  );
}

function Cifra({ valor, etiqueta }: { valor: number; etiqueta: string }) {
  return (
    <div className="text-center">
      <dd className="tabular text-base font-medium">{valor}</dd>
      <dt className="text-sm text-muted-foreground">{etiqueta}</dt>
    </div>
  );
}
