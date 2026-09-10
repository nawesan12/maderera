import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { asc } from "drizzle-orm";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { db } from "@/lib/db";
import { cuttingRates } from "@/lib/db/schema";
import { requireStaffRole } from "@/lib/dal/session";
import { listarListasDePrecios } from "@/lib/dal/admin/precios";
import { EditorDeTarifa } from "./editor";

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

  const [tarifas, listas] = await Promise.all([
    db
      .select()
      .from(cuttingRates)
      .orderBy(asc(cuttingRates.material), asc(cuttingRates.priceListId)),
    listarListasDePrecios(),
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
        detalle="Cuánto se cobra cada pasada de sierra, según el material y quién compra."
      />

      <div className="rounded-xl border bg-muted/40 p-5 text-base">
        <p>
          <strong>El corte se cobra por pasada.</strong> Cuántas pasadas lleva un
          trabajo lo decide el patrón que arma el optimizador de la máquina, así
          que el número se carga en la ficha del corte{" "}
          <strong>después de optimizar</strong>. Hasta entonces la ficha avisa
          que el trabajo todavía no se puede cobrar, en vez de inventar un
          mínimo.
        </p>
        <p className="mt-2 text-muted-foreground">
          Una lista sin tarifa propia cae a la de público, igual que el precio
          del catálogo: quedarse sin tarifa significaría no cobrar el corte.
        </p>
      </div>

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
