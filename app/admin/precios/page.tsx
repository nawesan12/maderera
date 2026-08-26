import Image from "next/image";
import Link from "next/link";
import { Download, ImageOff, Tags } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { GrupoListado } from "@/components/admin/grupo";
import { fechaHora, haceCuanto, moneda, plural } from "@/components/admin/formato";
import { BuscadorProductos } from "@/app/admin/productos/buscador";
import { listarCategoriasAdmin } from "@/lib/dal/admin/products";
import {
  DIAS_PARA_REVISAR,
  historialDePrecios,
  listarListasDePrecios,
  listarPrecios,
  type FilaPrecio,
} from "@/lib/dal/admin/precios";
import { DialogoAjuste } from "./dialogo-ajuste";
import { DialogoImportar } from "./dialogo-importar";
import { PrecioEditable } from "./precio-editable";

const origenTexto: Record<string, string> = {
  manual: "Edición",
  ajuste_masivo: "Ajuste masivo",
  importacion: "Importación",
};

/** Un precio que no se toca hace más de dos meses probablemente quedó viejo. */

export default async function PreciosPage({
  searchParams,
}: {
  searchParams: Promise<{ buscar?: string; cat?: string }>;
}) {
  const params = await searchParams;

  const [filas, categorias, listas, historial] = await Promise.all([
    listarPrecios({ busqueda: params.buscar, categoria: params.cat }),
    listarCategoriasAdmin(),
    listarListasDePrecios(),
    historialDePrecios(10),
  ]);

  const general = listas.find((l) => l.isDefault);
  const profesional = listas.find((l) => l.slug === "profesional");

  // El criterio de "quedó viejo" lo resuelve el DAL: depende de la hora actual,
  // y leerla durante el render de un Server Component es una impureza.
  const sinPrecio = filas.filter((f) => Number(f.precioGeneral) <= 0);
  const desactualizados = filas.filter((f) => f.desactualizado);
  const alDia = filas.filter(
    (f) => !sinPrecio.includes(f) && !desactualizados.includes(f),
  );

  const consulta = new URLSearchParams();
  if (params.buscar) consulta.set("buscar", params.buscar);
  if (params.cat) consulta.set("cat", params.cat);
  const urlExportar = `/admin/precios/exportar${
    consulta.size > 0 ? `?${consulta}` : ""
  }`;

  return (
    <div>
      <EncabezadoPanel
        titulo="Precios"
        detalle={
          sinPrecio.length > 0
            ? `${plural(filas.length, "medida")} · ${sinPrecio.length} sin precio`
            : plural(filas.length, "medida con precio", "medidas con precio")
        }
      >
        <a
          href={urlExportar}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
        >
          <Download className="h-5 w-5" />
          Exportar
        </a>
        <DialogoImportar />
        <DialogoAjuste
          categorias={categorias.map((c) => ({ slug: c.slug, name: c.name }))}
          categoriaActual={params.cat ?? "todos"}
        />
      </EncabezadoPanel>

      <BuscadorProductos
        categorias={categorias}
        busquedaActual={params.buscar ?? ""}
        categoriaActual={params.cat ?? "todos"}
      />

      {filas.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed py-16 text-center">
          <Tags className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-base font-medium">Ningún producto coincide</p>
          <p className="mt-1 text-base text-muted-foreground">
            Probá con otro nombre, código o categoría.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid gap-6 2xl:grid-cols-[1fr_320px]">
          <div>
            <GrupoListado
              titulo="Sin precio cargado"
              cantidad={sinPrecio.length}
              detalle="No se pueden vender por la tienda"
              destacado
            >
              <Grilla
                filas={sinPrecio}
                generalId={general?.id}
                profesionalId={profesional?.id}
              />
            </GrupoListado>

            <GrupoListado
              titulo="Para revisar"
              cantidad={desactualizados.length}
              detalle={`Sin cambios hace más de ${DIAS_PARA_REVISAR} días`}
              destacado
            >
              <Grilla
                filas={desactualizados}
                generalId={general?.id}
                profesionalId={profesional?.id}
              />
            </GrupoListado>

            <GrupoListado titulo="Actualizados" cantidad={alDia.length}>
              <Grilla
                filas={alDia}
                generalId={general?.id}
                profesionalId={profesional?.id}
              />
            </GrupoListado>
          </div>

          <aside className="2xl:sticky 2xl:top-24 2xl:self-start">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Últimos cambios
            </h2>
            {historial.length === 0 ? (
              <p className="rounded-xl border border-dashed px-3 py-6 text-center text-base text-muted-foreground">
                Todavía no se cambió ningún precio.
              </p>
            ) : (
              <ul className="tarjeta-hundida overflow-hidden">
                {historial.map((cambio) => {
                  const anterior = Number(cambio.precioAnterior ?? 0);
                  const nuevo = Number(cambio.precioNuevo);
                  const subio = nuevo > anterior;

                  return (
                    <li
                      key={cambio.id}
                      className="border-b border-border/60 px-3 py-3 last:border-0"
                    >
                      <p className="truncate text-base">{cambio.producto}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {cambio.medida} · {cambio.lista}
                      </p>
                      <p className="mt-1 flex items-center gap-1.5 text-sm">
                        <span className="tabular text-muted-foreground line-through">
                          {cambio.precioAnterior
                            ? moneda.format(anterior)
                            : "—"}
                        </span>
                        <span
                          className={`tabular font-medium ${
                            subio ? "text-brand-orange" : "text-green-700"
                          }`}
                        >
                          {moneda.format(nuevo)}
                        </span>
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {origenTexto[cambio.origen] ?? cambio.origen} ·{" "}
                        {fechaHora.format(cambio.createdAt)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function Grilla({
  filas,
  generalId,
  profesionalId,
}: {
  filas: FilaPrecio[];
  generalId?: string;
  profesionalId?: string;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {filas.map((fila) => (
        <TarjetaPrecio
          key={fila.variantId}
          fila={fila}
          generalId={generalId}
          profesionalId={profesionalId}
        />
      ))}
    </div>
  );
}

function TarjetaPrecio({
  fila,
  generalId,
  profesionalId,
}: {
  fila: FilaPrecio;
  generalId?: string;
  profesionalId?: string;
}) {
  const sinPrecio = Number(fila.precioGeneral) <= 0;

  return (
    <article className={`flex gap-4 p-4 ${sinPrecio ? "tarjeta-atencion" : "tarjeta"}`}>
      <Link
        href={`/admin/productos/${fila.productId}`}
        className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-muted"
      >
        {fila.imagen ? (
          <Image
            src={fila.imagen}
            alt={fila.producto}
            fill
            className="object-cover"
            sizes="80px"
          />
        ) : (
          <span className="flex h-full items-center justify-center text-muted-foreground">
            <ImageOff className="h-5 w-5" />
          </span>
        )}
      </Link>

      <div className="min-w-0 flex-1">
        <Link
          href={`/admin/productos/${fila.productId}`}
          className="text-base font-medium leading-snug hover:text-brand-orange"
        >
          {fila.producto}
        </Link>
        <p className="text-sm text-muted-foreground">{fila.medida}</p>
        <p className="tabular text-sm text-muted-foreground">
          {fila.sku}
          {fila.actualizado && ` · ${haceCuanto(fila.actualizado)}`}
        </p>

        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 border-t pt-3">
          <dt className="self-center text-sm text-muted-foreground">
            Lista general
          </dt>
          <dd>
            {generalId && (
              <PrecioEditable
                variantId={fila.variantId}
                priceListId={generalId}
                valor={fila.precioGeneral}
              />
            )}
          </dd>

          <dt className="self-center text-sm text-muted-foreground">
            Profesional
            {fila.brecha !== null && (
              <span className="tabular ml-1 text-brand-orange">
                −{fila.brecha}%
              </span>
            )}
          </dt>
          <dd>
            {profesionalId && (
              <PrecioEditable
                variantId={fila.variantId}
                priceListId={profesionalId}
                valor={fila.precioProfesional}
              />
            )}
          </dd>
        </dl>
      </div>
    </article>
  );
}
