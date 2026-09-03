import Link from "next/link";
import { Plus, Settings2 } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { plural } from "@/components/admin/formato";
import { listarCortes } from "@/lib/dal/admin/cortes";
import { BuscadorCortes } from "./buscador";
import { TableroDeCortes } from "./vista";

export default async function CortesPage({
  searchParams,
}: {
  searchParams: Promise<{ buscar?: string }>;
}) {
  const params = await searchParams;
  const cortes = await listarCortes({ busqueda: params.buscar });

  const pendientes = cortes.filter((c) =>
    ["en-cola", "en-proceso"].includes(c.estado),
  );
  const superficiePendiente = pendientes.reduce(
    (s, c) => s + c.metrosCuadrados,
    0,
  );

  return (
    <div>
      <EncabezadoPanel
        titulo="Cortes"
        detalle={
          pendientes.length > 0
            ? `${plural(pendientes.length, "trabajo")} por hacer · ${Math.round(superficiePendiente)} m² de placa`
            : `${plural(cortes.length, "trabajo")} en total`
        }
      >
        {/* Hasta acá el tablero sabía mover cortes pero no crearlos: los que
            había los había puesto el sembrado de prueba. */}
        <Link
          href="/admin/cortes/nuevo"
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-3.5 text-base font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="h-5 w-5" />
          Nuevo corte
        </Link>

        <Link
          href="/admin/cortes/formato"
          className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted"
        >
          <Settings2 className="h-5 w-5" />
          Formato para la máquina
        </Link>
      </EncabezadoPanel>

      <BuscadorCortes busquedaActual={params.buscar ?? ""} />

      <TableroDeCortes cortes={cortes} />
    </div>
  );
}
