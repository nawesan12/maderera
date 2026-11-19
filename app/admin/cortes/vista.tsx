import Link from "next/link";
import { Flame, ListChecks, Scissors } from "lucide-react";
import {
  ColumnaTablero,
  TarjetaTablero,
  Tablero,
} from "@/components/admin/kanban";
import { haceCuanto } from "@/components/admin/formato";
import { diasDesde } from "@/lib/formato";
import { formatearDecimal } from "@/lib/unidades";

/** Más de esto en el tablero, el corte se marca como demorado. */
const DIAS_DE_DEMORA = 3;
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
  { estado: "en-cola", titulo: "En cola" },
  { estado: "en-proceso", titulo: "En la máquina" },
  { estado: "terminado", titulo: "Terminados" },
  { estado: "retirado", titulo: "Retirados" },
] as const;

export function TableroDeCortes({
  cortes,
  avisos = {},
  soloMaquina = false,
}: {
  cortes: CorteListado[];
  /** El tablero del aserradero: solo empezar y terminar. */
  soloMaquina?: boolean;
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
              // Con la misma función que las tarjetas: si el encabezado
              // dice 4 y las tarjetas suman 4,32, parece que falta algo. Sin
              // decimales fijos: es una sola cifra, no una columna que alinear.
              detalle={
                enColumna.length > 0
                  ? `${formatearDecimal(metros)} m²`
                  : undefined
              }
              estado={columna.estado}
            >
              {enColumna.map((corte, i) => (
                <TarjetaCorte
                  key={corte.id}
                  corte={corte}
                  posicion={columna.estado === "en-cola" ? i + 1 : undefined}
                  aviso={avisos[corte.id] ?? null}
                  soloMaquina={soloMaquina}
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
  soloMaquina = false,
}: {
  corte: CorteListado;
  posicion?: number;
  aviso: AvisoManualListo | null;
  soloMaquina?: boolean;
}) {
  // Un trabajo que lleva más de tres días sin terminar avisa solo: en la
  // pizarra uno de hace dos meses se veía igual que uno de hoy.
  const dias = diasDesde(corte.createdAt);
  const demorado = corte.estado !== "retirado" && dias > DIAS_DE_DEMORA;
  return (
    <TarjetaTablero destacada={corte.urgente || demorado}>
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
          {/* Dos renglones antes de cortar: con el ancho solo, los nombres
              largos de cliente se perdían. */}
          <Link
            href={`/admin/cortes/${corte.id}`}
            className="line-clamp-2 break-words text-base font-medium hover:text-brand-orange"
          >
            {corte.cliente}
          </Link>
        </div>
        <span className="codigo shrink-0">
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
        <Cifra
          valor={formatearDecimal(corte.metrosCuadrados, 2, { fijo: true })}
          etiqueta="m²"
        />
      </dl>

      {corte.notas && (
        <p className="mt-2 text-sm text-muted-foreground">{corte.notas}</p>
      )}

      <p className={`mt-2 text-sm ${demorado ? "estado-problema font-medium" : "text-muted-foreground"}`}>
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
          soloMaquina={soloMaquina}
        />
      </div>
    </TarjetaTablero>
  );
}

function Cifra({ valor, etiqueta }: { valor: number | string; etiqueta: string }) {
  return (
    <div className="text-center">
      <dd className="tabular text-base font-medium">{valor}</dd>
      <dt className="text-sm text-muted-foreground">{etiqueta}</dt>
    </div>
  );
}
