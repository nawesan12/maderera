import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { todasLasTarifas } from "@/lib/dal/cortes-tarifas";
import { requireStaffRole } from "@/lib/dal/session";
import { listarListasDePrecios } from "@/lib/dal/admin/precios";
import { EditorDeTarifa } from "./editor";
import { EditorDeSierra } from "./sierra";
import { anchoDeSierra } from "@/lib/dal/sierra";

export const metadata: Metadata = { title: "Tarifas de corte" };

/**
 * Cuánto se cobra por cortar.
 *
 * Hasta que existió esta pantalla, el corte **no se cobraba en ninguna parte
 * del sistema**: ni la orden ni sus piezas tenían una columna de importe, y la
 * única forma de que entrara la plata era que el vendedor tipeara una línea
 * suelta en el mostrador con el número de memoria. Dos vendedores podían
 * cobrar distinto por el mismo trabajo.
 */
export default async function TarifasDeCortePage() {
  await requireStaffRole("admin");

  const [tarifas, listas, sierra] = await Promise.all([
    todasLasTarifas(),
    listarListasDePrecios(),
    anchoDeSierra(),
  ]);

  const opciones = listas.map((l) => ({
    id: l.id,
    nombre: l.name,
    esGeneral: l.isDefault,
  }));

  const nombreDeLista = (id: string | null) =>
    id ? (opciones.find((l) => l.id === id)?.nombre ?? "Lista dada de baja") : "Público";

  return (
    <div className="space-y-6">
      <Link
        href="/admin/cortes"
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
        Volver a cortes
      </Link>

      <EncabezadoPanel
        titulo="Tarifas de corte"
      />

      <EditorDeSierra anchoSierraMm={sierra} />

      <div className="space-y-4">
        {tarifas.map((tarifa) => (
          <div key={tarifa.id} className="space-y-2">
            <p className="text-base font-semibold">
              {tarifa.material}
              <span className="ml-2 font-normal text-muted-foreground">
                {nombreDeLista(tarifa.priceListId)}
                {!tarifa.activo && " · no se cobra"}
              </span>
            </p>
            <EditorDeTarifa
              tarifa={{
                id: tarifa.id,
                material: tarifa.material,
                priceListId: tarifa.priceListId,
                precioPorPasada: tarifa.precioPorPasada,
                precioPorMetroCanto: tarifa.precioPorMetroCanto,
                activo: tarifa.activo,
              }}
              listas={opciones}
            />
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <h2 className="text-base font-semibold">Agregar una tarifa</h2>
        <EditorDeTarifa tarifa={null} listas={opciones} />
      </div>
    </div>
  );
}
