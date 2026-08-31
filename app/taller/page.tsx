import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { LayoutDashboard, Settings2 } from "lucide-react";
import { requireStaff } from "@/lib/dal/session";
import { listarCortes } from "@/lib/dal/admin/cortes";
import { plural } from "@/components/admin/formato";
import { BuscadorCortes } from "@/app/admin/cortes/buscador";
import { TableroDeCortes } from "@/app/admin/cortes/vista";

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
 */
export default async function TallerPage({
  searchParams,
}: {
  searchParams: Promise<{ buscar?: string }>;
}) {
  const usuario = await requireStaff();
  const params = await searchParams;
  const cortes = await listarCortes({ busqueda: params.buscar });

  const pendientes = cortes.filter((c) =>
    ["en-cola", "en-proceso"].includes(c.estado),
  );
  const superficie = pendientes.reduce((s, c) => s + c.metrosCuadrados, 0);

  // El aserradero es el único rol que no tiene el panel detrás, así que para
  // los demás dejamos la puerta de vuelta.
  const puedeVolverAlPanel = usuario.staffRole !== "aserradero";

  return (
    <div className="panel panel-fondo flex min-h-screen flex-col text-[17px] text-foreground">
      <header className="flex h-[60px] shrink-0 items-center gap-3.5 border-b border-linea bg-sidebar px-[18px]">
        <span className="flex items-center gap-2.5">
          <Image
            src="/cropped-icon-180x180.png"
            alt=""
            width={30}
            height={30}
            className="rounded-lg"
          />
          <span className="text-[17px] font-semibold">Taller</span>
        </span>

        {pendientes.length > 0 && (
          <span
            className="tabular flex h-6 min-w-6 items-center justify-center rounded-full bg-accion px-[7px] text-sm font-semibold text-white"
            aria-label={`${pendientes.length} trabajos por hacer`}
          >
            {pendientes.length}
          </span>
        )}

        <span className="tabular ml-auto hidden text-base text-texto-2 sm:block">
          {Math.round(superficie)} m² de placa por cortar
        </span>

        <span className="text-base text-texto-2">{usuario.name}</span>

        <Link
          href="/admin/cortes/formato"
          className="inline-flex h-11 items-center gap-2 rounded-[9px] border border-linea bg-card px-3.5 text-base font-medium transition-colors hover:bg-hundida"
        >
          <Settings2 className="h-5 w-5" />
          <span className="hidden md:inline">Formato</span>
        </Link>

        {puedeVolverAlPanel && (
          <Link
            href="/admin/cortes"
            className="inline-flex h-11 items-center gap-2 rounded-[9px] border border-linea bg-card px-3.5 text-base font-medium transition-colors hover:bg-hundida"
          >
            <LayoutDashboard className="h-5 w-5" />
            <span className="hidden md:inline">Volver al panel</span>
          </Link>
        )}
      </header>

      {/* El padding tiene que ser el que espera `Tablero`, que se estira con
          márgenes negativos para que las columnas lleguen al borde. Con otro
          valor sobresale y empuja el documento. */}
      <main className="flex-1 px-4 pb-8 pt-4 lg:px-7">
        <h1 className="sr-only">Cola de corte</h1>

        <p className="mb-3 text-base text-texto-2">
          {pendientes.length > 0
            ? `${plural(pendientes.length, "trabajo")} por hacer`
            : "No hay trabajos pendientes."}
        </p>

        <BuscadorCortes busquedaActual={params.buscar ?? ""} />
        <TableroDeCortes cortes={cortes} />
      </main>
    </div>
  );
}
