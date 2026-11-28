import Link from "next/link";
import { Download, Flame, ListChecks, Scissors, SearchX } from "lucide-react";
import {
  ColumnaTablero,
  TarjetaTablero,
  Tablero,
} from "@/components/admin/kanban";
import { haceCuanto } from "@/components/admin/formato";
import { diasDesde } from "@/lib/formato";
import { formatearDecimal } from "@/lib/unidades";
import type { CorteListado } from "@/lib/dal/admin/cortes";
import { AccionesCorte } from "./acciones";
import { AvisarPorWhatsapp } from "@/components/admin/avisar-por-whatsapp";
import type { AvisoManualListo } from "@/lib/whatsapp/aviso-manual-datos";

/** Más de esto en el tablero, el corte se marca como demorado. */
const DIAS_DE_DEMORA = 3;

/**
 * La cola de corte.
 *
 * Vive acá y no en la página porque la usan dos pantallas: `/admin/cortes`,
 * dentro del panel, y `/taller`, que es la misma cola sola en la pantalla del
 * aserradero. Duplicarla habría hecho que las dos se separaran en el primer
 * cambio, que es justo lo que no se quiere en la pantalla que decide qué se
 * corta primero.
 *
 * En el taller la pantalla es del trabajo (mes simulado, H404): la cola y la
 * máquina se llevan el ancho, los terminados se pliegan a los últimos tres y
 * los retirados no están, porque el operario no tiene nada que hacer con
 * ellos.
 */
const COLUMNAS = [
  { estado: "en-cola", titulo: "En cola" },
  { estado: "en-proceso", titulo: "En la máquina" },
  { estado: "terminado", titulo: "Terminados" },
  { estado: "retirado", titulo: "Retirados" },
] as const;

/** Lo que ya salió de la máquina, lo más reciente primero (H328). */
function recientePrimero(a: CorteListado, b: CorteListado) {
  return (b.salioAt?.getTime() ?? b.createdAt.getTime()) - (a.salioAt?.getTime() ?? a.createdAt.getTime());
}

export function TableroDeCortes({
  cortes,
  avisos = {},
  soloMaquina = false,
  taller = false,
  busqueda = "",
  limpiar,
  verSucursal = true,
}: {
  cortes: CorteListado[];
  /** El tablero del aserradero: solo empezar y terminar. */
  soloMaquina?: boolean;
  /** La pantalla de /taller: sin retirados y con los terminados plegados. */
  taller?: boolean;
  /** El aviso gratis de «corte terminado», por id de corte. */
  avisos?: Record<string, AvisoManualListo>;
  /** Lo que se buscó: el vacío dice que no coincide, no que no hay cortes. */
  busqueda?: string;
  /** Adónde vuelve «Limpiar la búsqueda». */
  limpiar?: string;
  /** Con la cola filtrada por taller, la sucursal de cada tarjeta sobra. */
  verSucursal?: boolean;
}) {
  const columnas = taller ? COLUMNAS.filter((c) => c.estado !== "retirado") : COLUMNAS;
  const visibles = cortes.filter((c) => columnas.some((col) => col.estado === c.estado));

  if (visibles.length === 0) {
    return busqueda ? (
      <div className="tarjeta-hundida mt-6 rounded-xl px-5 py-12 text-center">
        <SearchX className="mx-auto mb-3 h-8 w-8 text-muted-foreground" aria-hidden />
        <p className="text-base font-medium">Ningún corte coincide con «{busqueda}»</p>
        {limpiar && (
          <Link
            href={limpiar}
            className="mt-4 inline-flex h-12 items-center rounded-lg border px-4 text-base font-medium transition-colors hover:bg-muted"
          >
            Limpiar la búsqueda
          </Link>
        )}
      </div>
    ) : taller ? (
      // En el taller el vacío es el de su cola, grande y al centro, también
      // sin ningún terminado: era un renglón chico arriba a la izquierda
      // sobre la pantalla en blanco (mes simulado, M2S4-040).
      <div className="tarjeta-hundida mt-[18px] flex min-h-[50vh] flex-col items-center justify-center rounded-xl px-5 py-16 text-center">
        <Scissors className="mb-3 h-10 w-10 text-muted-foreground" aria-hidden />
        <p className="text-xl font-semibold">La cola está vacía</p>
      </div>
    ) : (
      <div className="tarjeta-hundida mt-6 rounded-xl px-5 py-12 text-center">
        <Scissors className="mx-auto mb-3 h-8 w-8 text-muted-foreground" aria-hidden />
        <p className="text-base font-medium">La cola está vacía</p>
      </div>
    );
  }

  if (taller) {
    return (
      <TableroDelTaller
        cortes={cortes}
        avisos={avisos}
        soloMaquina={soloMaquina}
        verSucursal={verSucursal}
      />
    );
  }

  return (
    <Tablero>
      {columnas.map((columna) => {
        const enColumna = cortes.filter((c) => c.estado === columna.estado);
        if (columna.estado === "terminado" || columna.estado === "retirado") enColumna.sort(recientePrimero);
        const metros = enColumna.reduce((s, c) => s + c.metrosCuadrados, 0);

        return (
          <ColumnaTablero
            key={columna.estado}
            titulo={columna.titulo}
            cantidad={enColumna.length}
            // Con la misma función que las tarjetas: si el encabezado
            // dice 4 y las tarjetas suman 4,32, parece que falta algo. Con
            // dos decimales siempre: «2,6» al lado de «9,77» parecía otra
            // precisión (mes 23).
            detalle={
              enColumna.length > 0 && columna.estado !== "terminado" && columna.estado !== "retirado"
                ? `${formatearDecimal(metros, 2, { fijo: true })} m²`
                : undefined
            }
            estado={columna.estado}
            tope={taller && columna.estado === "terminado" ? 3 : undefined}
            secundaria={taller && columna.estado === "terminado"}
          >
            {enColumna.map((corte, i) => (
              <TarjetaCorte
                key={corte.id}
                corte={corte}
                posicion={columna.estado === "en-cola" ? i + 1 : undefined}
                aviso={avisos[corte.id] ?? null}
                soloMaquina={soloMaquina}
                verSucursal={verSucursal}
              />
            ))}
          </ColumnaTablero>
        );
      })}
    </Tablero>
  );
}

/**
 * El tablero del taller, ordenado por lo que el operario tiene entre manos
 * (mes simulado, M2S1-066, M2S2-108, M2S4-040 y M3S1-040): lo que está en la
 * máquina arriba de todo en el teléfono, y en una pantalla ancha la cola a la
 * izquierda y la máquina con los terminados debajo a la derecha, para que
 * esa columna no quede vacía. La cola se ve entera (un «Ver 1 más» escondía
 * un trabajo pendiente) y nada scrollea por dentro.
 */
function TableroDelTaller({
  cortes,
  avisos,
  soloMaquina,
  verSucursal,
}: {
  cortes: CorteListado[];
  avisos: Record<string, AvisoManualListo>;
  soloMaquina: boolean;
  verSucursal: boolean;
}) {
  const de = (estado: string) => cortes.filter((c) => c.estado === estado);
  const cola = de("en-cola");
  const maquina = de("en-proceso");
  const terminados = de("terminado").sort(recientePrimero);
  const m2 = (lista: CorteListado[]) =>
    lista.length > 0 ? `${formatearDecimal(lista.reduce((s, c) => s + c.metrosCuadrados, 0), 2, { fijo: true })} m²` : undefined;
  const tarjetas = (lista: CorteListado[], enCola = false) =>
    lista.map((corte, i) => (
      <TarjetaCorte
        key={corte.id}
        corte={corte}
        posicion={enCola ? i + 1 : undefined}
        aviso={avisos[corte.id] ?? null}
        soloMaquina={soloMaquina}
        verSucursal={verSucursal}
      />
    ));

  // Sin nada en la máquina ni terminado, la cola se lleva el ancho entero,
  // de a dos tarjetas (M4-090).
  const sola = maquina.length === 0 && terminados.length === 0;

  return (
    <div className={`mt-[18px] grid items-start gap-3 ${sola ? "" : "lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"}`}>
      {maquina.length > 0 && (
        <div className="lg:col-start-2 lg:row-start-1">
          <ColumnaTablero titulo="En la máquina" cantidad={maquina.length} detalle={m2(maquina)} estado="en-proceso" tope={Infinity} largo>
            {tarjetas(maquina)}
          </ColumnaTablero>
        </div>
      )}
      <div className="lg:col-start-1 lg:row-span-3 lg:row-start-1">
        {cola.length > 0 ? (
          <ColumnaTablero titulo="En cola" cantidad={cola.length} detalle={m2(cola)} estado="en-cola" tope={Infinity} largo enDos={sola}>
            {tarjetas(cola, true)}
          </ColumnaTablero>
        ) : (
          <div className="tarjeta-hundida flex flex-col items-center justify-center rounded-xl px-5 py-16 text-center lg:min-h-[50vh]">
            <Scissors className="mb-3 h-10 w-10 text-muted-foreground" aria-hidden />
            <p className="text-xl font-semibold">La cola está vacía</p>
          </div>
        )}
      </div>
      {terminados.length > 0 && (
        <div className="lg:col-start-2">
          <ColumnaTablero titulo="Terminados" cantidad={terminados.length} estado="terminado" tope={3} secundaria largo>
            {tarjetas(terminados)}
          </ColumnaTablero>
        </div>
      )}
    </div>
  );
}

function TarjetaCorte({
  corte,
  posicion,
  aviso,
  soloMaquina = false,
  verSucursal,
}: {
  corte: CorteListado;
  posicion?: number;
  aviso: AvisoManualListo | null;
  soloMaquina?: boolean;
  verSucursal: boolean;
}) {
  // Un trabajo que lleva más de tres días sin terminar avisa solo: en la
  // pizarra uno de hace dos meses se veía igual que uno de hoy.
  const dias = diasDesde(corte.createdAt);
  const pendiente = corte.estado === "en-cola" || corte.estado === "en-proceso";
  const demorado = pendiente && dias > DIAS_DE_DEMORA;
  // Lo que ya salió cuenta desde que salió, no desde el alta (H128).
  const desde = pendiente ? corte.createdAt : (corte.salioAt ?? corte.createdAt);
  // El taller termina y ahí se le acaban los botones: sin pie vacío (H128).
  const hayAcciones = !(soloMaquina && corte.estado === "terminado") && corte.estado !== "retirado";
  const unidad = corte.mitad
    ? corte.placas === 1 ? "media" : "medias"
    : corte.placas === 1 ? "placa" : "placas";

  return (
    // Terminado, la urgencia ya no le dice nada al taller (M2S1-149).
    <TarjetaTablero destacada={(corte.urgente && pendiente) || demorado}>
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
              largos de cliente se perdían. Toda la línea abre la ficha: era
              un enlace de 24 px. */}
          <Link
            href={`/admin/cortes/${corte.id}`}
            className="-my-2 line-clamp-2 break-words py-2 text-base font-medium hover:text-brand-orange"
          >
            {corte.cliente}
          </Link>
        </div>
        <span className="codigo shrink-0">
          {corte.numero}
        </span>
      </div>

      {((corte.urgente && pendiente) || corte.sinCargo || (verSucursal && corte.sucursal)) && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {corte.urgente && pendiente && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-orange/15 px-2 py-0.5 text-sm font-medium text-brand-orange-dark">
              <Flame className="h-3.5 w-3.5" />
              Urgente
            </span>
          )}
          {/* La reposición no se cobra: la tarjeta lo dice como la ficha
              (mes 23, CRT-16). */}
          {corte.sinCargo && (
            <span className="inline-flex items-center rounded-full bg-hundida px-2 py-0.5 text-sm font-semibold text-foreground">
              Sin cargo
            </span>
          )}
          {/* De qué taller y de qué depósito sale la placa (H122). */}
          {verSucursal && corte.sucursal && (
            <span className="inline-flex items-center rounded-full bg-hundida px-2 py-0.5 text-sm font-medium text-texto-2">
              {corte.sucursal}
            </span>
          )}
        </div>
      )}

      {/* El espesor primero: es lo que mira el operario para bajar la
          placa, y al final pasaba al segundo renglón (M4-091). */}
      <MaterialConEspesor material={corte.material} />

      {/* Las tres cifras que define el trabajo del operario: las placas son
          las del plano, que es lo que se baja del depósito. */}
      <dl className="mt-2.5 grid grid-cols-3 gap-2 rounded-md bg-muted/60 px-2.5 py-2">
        <Cifra valor={corte.placas} etiqueta={unidad} />
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
        {haceCuanto(desde)}
      </p>

      {aviso && (
        <div className="mt-3">
          <AvisarPorWhatsapp aviso={aviso} compacto />
        </div>
      )}

      {/* Lo que se abre antes de cargar la placa, a un toque: la hoja y el
          archivo de la máquina, juntos (H327). */}
      {corte.piezas > 0 && pendiente && (
        // Cada botón toma el ancho de su texto y crecen juntos: en dos
        // columnas iguales «Hoja de corte» se cortaba en «Hoja de cor…» a
        // 375 px (mes simulado, H327). Si no entran, bajan de renglón.
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Link
            href={`/hoja-de-corte/${corte.id}`}
            target="_blank"
            className="inline-flex h-12 flex-auto items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
          >
            <ListChecks className="h-5 w-5 shrink-0" />
            Hoja de corte
          </Link>
          <a
            href={`/api/cortes/${corte.id}/lista`}
            title="Archivo para la máquina"
            aria-label="Archivo para la máquina"
            className="inline-flex h-12 flex-auto items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
          >
            <Download className="h-5 w-5 shrink-0" />
            Archivo
          </a>
        </div>
      )}

      {hayAcciones && (
        <div className="mt-auto border-t pt-3">
          <AccionesCorte
            id={corte.id}
            estado={corte.estado}
            urgente={corte.urgente}
            // La reposición sin cargo no cobra: termina con un toque, sin
            // confirmar pasadas (mes simulado, M3S1-038).
            pasadas={corte.sinCargo ? 0 : corte.pasadas}
            pedidoId={corte.orderId ?? null}
            sinCargo={corte.sinCargo}
            compacto
            soloMaquina={soloMaquina}
            // El naranja lleno, solo en el primero de la cola: tres
            // «Empezar» iguales no dicen cuál va (M4-091).
            secundario={posicion !== undefined && posicion > 1}
          />
        </div>
      )}
    </TarjetaTablero>
  );
}

/** «Melamina Blanca — 2600 × 1830 mm — 18mm» como «18 mm Melamina Blanca — 2600 × 1830 mm». */
function MaterialConEspesor({ material }: { material: string }) {
  const m = /^(.*?)\s*[—-]\s*(\d+(?:[.,]\d+)?)\s*mm\s*$/i.exec(material);
  if (!m || !m[1]) return <p className="mt-2 text-base">{material}</p>;
  return (
    <p className="mt-2 text-base">
      <span className="tabular font-semibold">{m[2]} mm</span> {m[1]}
    </p>
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
