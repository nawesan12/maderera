import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CircleHelp, LayoutDashboard } from "lucide-react";
import { requireStaff } from "@/lib/dal/session";
import { listarCortes } from "@/lib/dal/admin/cortes";
import { listarSucursalesPublicas } from "@/lib/dal/envios";
import { plural } from "@/components/admin/formato";
import { esUuid } from "@/lib/uuid";
import { DECIDEN_EN_LA_COLA } from "@/lib/roles";
import { BuscadorCortes } from "@/app/admin/cortes/buscador";
import { TableroDeCortes } from "@/app/admin/cortes/vista";
import { RefrescarEnVivo } from "@/components/vivo/refrescar-en-vivo";
import { Marca } from "@/components/marca";
import { AvisoSinAcceso } from "@/components/admin/aviso-sin-acceso";

export const metadata: Metadata = {
  title: "Taller · Cola de corte",
  robots: { index: false, follow: false },
};

/**
 * Puesto del aserradero.
 *
 * Es la misma cola de `/admin/cortes` sola en la pantalla, para quien opera la
 * seccionadora y deja esta pestaña abierta todo el día: sin menú lateral, sin
 * buscador global y sin las diecisiete secciones que no son suyas.
 *
 * Vive fuera de `/admin` por lo mismo que `/atencion`: el layout del panel trae
 * el menú y la cabecera, y acá lo que se busca es que no estén. Esconderlos con
 * CSS es la clase de arreglo que después se rompe sin que nadie sepa por qué.
 *
 * El tablero es el mismo componente, no una copia: si mañana la tarjeta suma un
 * dato, aparece en las dos pantallas.
 *
 * El formato del archivo para la máquina salió del encabezado (mes simulado,
 * H231 y H120): era el botón más visible y abría una configuración que el
 * operario no tiene que tocar; el archivo de cada corte está en su tarjeta.
 */
export default async function TallerPage({
  searchParams,
}: {
  searchParams: Promise<{ buscar?: string; sucursal?: string }>;
}) {
  const usuario = await requireStaff();
  const params = await searchParams;
  const busqueda = params.buscar?.trim() ?? "";
  const sucursal = params.sucursal && esUuid(params.sucursal) ? params.sucursal : "";
  const [cortes, todos, sucursales] = await Promise.all([
    listarCortes({ busqueda, sucursal }),
    // El número del encabezado es el trabajo del taller, se busque lo que se
    // busque (H119: con una búsqueda vacía desaparecía).
    busqueda ? listarCortes({ sucursal }) : Promise.resolve(null),
    listarSucursalesPublicas(),
  ]);

  const pendientes = (todos ?? cortes).filter((c) =>
    ["en-cola", "en-proceso"].includes(c.estado),
  );
  const superficie = pendientes.reduce((s, c) => s + c.metrosCuadrados, 0);

  // El aserradero es el único rol que no tiene el panel detrás, así que para
  // los demás dejamos la puerta de vuelta.
  const puedeVolverAlPanel = usuario.staffRole !== "aserradero";
  const soloMaquina = !usuario.staffRole || !DECIDEN_EN_LA_COLA.includes(usuario.staffRole);

  return (
    <div className="panel panel-fondo flex min-h-screen flex-col text-[17px] text-foreground">
      <Suspense fallback={null}>
        <AvisoSinAcceso />
      </Suspense>
      {/* El mismo encabezado que el panel —claro, con textura—. En una línea a
          cualquier ancho: lo que no entra se va primero (el nombre, después
          los m²) y los botones quedan como íconos hasta que hay lugar para su
          texto (H120). */}
      <header className="textura flex h-[60px] min-w-0 shrink-0 items-center gap-3 border-b border-linea bg-background px-4 lg:px-7">
        <Marca tamano="panel" etiqueta="Taller" />

        {pendientes.length > 0 && (
          <span
            className="tabular flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-accion px-[7px] text-sm font-semibold text-white"
            aria-label={`${plural(pendientes.length, "trabajo")} por hacer`}
          >
            {pendientes.length}
          </span>
        )}

        <span aria-hidden className="ml-auto" />

        <span className="tabular hidden whitespace-nowrap text-base text-texto-2 md:block">
          {Math.round(superficie)} m² por cortar
        </span>

        <span className="hidden min-w-0 max-w-48 truncate text-base text-texto-2 xl:block">{usuario.name}</span>

        {/* La guía, acá: el aserradero no tiene panel detrás, así que este
            encabezado es todo lo que tiene. */}
        <Link
          href="/admin/ayuda/cortes-y-whatsapp"
          aria-label="Cómo se usa"
          className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-[9px] border border-linea bg-card px-3 text-base font-medium transition-colors hover:bg-hundida"
        >
          <CircleHelp className="h-5 w-5" />
          <span className="hidden whitespace-nowrap xl:inline">Cómo se usa</span>
        </Link>

        {puedeVolverAlPanel && (
          <Link
            href="/admin/cortes"
            aria-label="Volver al panel"
            className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-[9px] border border-linea bg-card px-3 text-base font-medium transition-colors hover:bg-hundida"
          >
            <LayoutDashboard className="h-5 w-5" />
            <span className="hidden whitespace-nowrap xl:inline">Volver al panel</span>
          </Link>
        )}
      </header>

      {/* El padding tiene que ser el que espera `Tablero`, que se estira con
          márgenes negativos para que las columnas lleguen al borde. Con otro
          valor sobresale y empuja el documento. */}
      <main className="flex-1 px-4 pb-8 pt-4 lg:px-7">
        <h1 className="sr-only">Cola de corte</h1>

        {!busqueda && (
          <p className="mb-3 text-base text-texto-2">
            {pendientes.length > 0
              ? `${plural(pendientes.length, "trabajo")} por hacer`
              : "No hay trabajos pendientes."}
          </p>
        )}

        <BuscadorCortes
          busquedaActual={busqueda}
          ruta="/taller"
          sucursales={sucursales.map((s) => ({ id: s.id, nombre: s.nombre }))}
          sucursalActual={sucursal}
        />
        {/* Un corte que se carga en el mostrador aparece acá al instante.
            Antes esta pantalla no se actualizaba nunca: quien cortaba tenía que
            recargarla para enterarse. */}
        <RefrescarEnVivo canales={["taller"]} sinConexionCadaMs={60_000} />
        <TableroDeCortes
          cortes={cortes}
          soloMaquina={soloMaquina}
          taller
          busqueda={busqueda}
          limpiar={sucursal ? `/taller?sucursal=${sucursal}` : "/taller"}
          verSucursal={!sucursal}
        />
      </main>
    </div>
  );
}
