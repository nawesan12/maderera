import Link from "next/link";
import { ArrowLeft, PackageX } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { candidatosDeBaja } from "@/lib/dal/admin/products";
import { mesesSinVenderParaBaja } from "@/lib/dal/admin/parametros-catalogo";
import { AlternarBaja } from "./alternar";
import { UmbralDeBaja } from "./umbral";

export const metadata = { title: "Candidatos a dar de baja" };

/**
 * Productos que quizá haya que dar de baja.
 *
 * La clienta pidió darlos de baja "de manera automática según parámetros".
 * Esta pantalla arma la lista y **nadie se desactiva solo**: un producto de
 * temporada que no se vende en trece meses y vuelve a venderse en el catorce
 * desaparecería del catálogo sin que nadie se entere, y eso se descubre cuando
 * un cliente pregunta por algo que ya no está.
 *
 * **El umbral se edita acá arriba.** Era una constante del código, así que
 * pasar de doce meses a dieciocho pedía un despliegue: eso no es un parámetro.
 * Ahora se guarda en `site_settings` y queda anotado en la bitácora, porque
 * cambia lo que ve todo el equipo en esta pantalla.
 */
export default async function CandidatosPage() {
  const meses = await mesesSinVenderParaBaja();
  const candidatos = await candidatosDeBaja({ mesesSinVender: meses });

  return (
    <div className="space-y-6">
      <Link
        href="/admin/productos"
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
        Volver a productos
      </Link>

      <EncabezadoPanel
        titulo="Candidatos a dar de baja"
        detalle="Sin ventas en el período de abajo, sin stock, o sin precio cargado. Nada se da de baja solo."
      >
        <UmbralDeBaja meses={meses} />
      </EncabezadoPanel>

      {candidatos.length === 0 ? (
        <section className="tarjeta px-5 py-10 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
            <PackageX className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-base font-medium">No hay nada para revisar</p>
          <p className="mt-1 text-base text-muted-foreground">
            Todos los productos activos se vendieron hace poco, tienen stock y
            tienen precio.
          </p>
        </section>
      ) : (
        <section className="tarjeta">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-4">
            <h2 className="text-base font-medium">
              {candidatos.length}{" "}
              {candidatos.length === 1 ? "producto" : "productos"} para revisar
            </h2>
            <p className="text-base text-muted-foreground">
              Dar de baja solo lo saca del sitio; el histórico queda
            </p>
          </div>

          <ul className="divide-y">
            {candidatos.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3"
              >
                <div className="min-w-[14rem] flex-1">
                  <Link
                    href={`/admin/productos/${c.id}`}
                    className="text-base font-medium transition-colors hover:text-brand-orange"
                  >
                    {c.nombre}
                  </Link>
                  <span className="block text-base text-muted-foreground">
                    {c.categoria}
                    {c.diasSinVender === null
                      ? ""
                      : ` · última venta hace ${c.diasSinVender} días`}
                  </span>
                </div>

                <ul className="flex flex-wrap gap-1.5">
                  {c.motivos.map((m) => (
                    <li
                      key={m}
                      className="rounded-full bg-muted px-2.5 py-1 text-sm text-muted-foreground"
                    >
                      {m}
                    </li>
                  ))}
                </ul>

                <span className="tabular text-base text-muted-foreground">
                  {c.stock} en stock
                </span>

                <AlternarBaja id={c.id} nombre={c.nombre} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
