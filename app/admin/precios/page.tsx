import Image from "next/image";
import Link from "next/link";
import { Download, FileText, ImageOff, Percent, Tags } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { leerPagina, Paginador } from "@/components/admin/paginador";
import { fechaHora, haceCuanto, moneda, plural } from "@/components/admin/formato";
import { BuscadorProductos } from "@/app/admin/productos/buscador";
import { listarCategoriasAdmin, marcasDeProductos } from "@/lib/dal/admin/products";
import {
  estadoDePrecio,
  historialDePrecios,
  listarListasDePrecios,
  listarPrecios,
  PRECIOS_POR_PAGINA,
  rubrosParaAjuste,
  ultimoAjuste,
  type FilaPrecio,
} from "@/lib/dal/admin/precios";
import { DialogoAjuste } from "./dialogo-ajuste";
import { DeshacerAjuste } from "./deshacer-ajuste";
import { proveedoresParaElegir } from "@/lib/dal/admin/proveedores";
import { DialogoImportar } from "./dialogo-importar";
import { PrecioEditable } from "./precio-editable";

const origenTexto: Record<string, string> = {
  manual: "Edición",
  ajuste_masivo: "Ajuste masivo",
  importacion: "Importación",
};

type Params = {
  buscar?: string;
  cat?: string;
  estado?: string;
  marca?: string;
  prov?: string;
  pagina?: string;
};

export default async function PreciosPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const pagina = leerPagina(params.pagina);

  // Precios es solo del admin, que también entra a Compras: el filtro por
  // proveedor va siempre.
  const [grilla, categorias, marcas, listas, historial, rubros, proveedores, ultimo] = await Promise.all([
    listarPrecios({
      busqueda: params.buscar,
      categoria: params.cat,
      estado: params.estado,
      marca: params.marca,
      proveedor: params.prov,
      pagina,
    }),
    listarCategoriasAdmin(),
    marcasDeProductos(),
    listarListasDePrecios(),
    historialDePrecios(10),
    rubrosParaAjuste(),
    proveedoresParaElegir(),
    ultimoAjuste(),
  ]);
  const { filas, total, conteos } = grilla;
  const estado = estadoDePrecio(params.estado) ?? "todos";

  const general = listas.find((l) => l.isDefault);
  const profesional = listas.find((l) => l.slug === "profesional");

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
        resumen={
          conteos.sinPrecio > 0
            ? `${plural(conteos.todas, "medida")} · ${conteos.sinPrecio} sin precio`
            : plural(conteos.todas, "medida con precio", "medidas con precio")
        }
      >
        <a
          href={urlExportar}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
        >
          <Download className="h-5 w-5" />
          Exportar
        </a>
        {/* El PDF es el que se le manda a un cliente: lleva membrete y fecha
            de vigencia. El CSV es para trabajarlo y volver a subirlo. */}
        <a
          href={`${urlExportar}${urlExportar.includes("?") ? "&" : "?"}formato=pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
        >
          <FileText className="h-5 w-5" />
          Lista en PDF
        </a>
        <DialogoImportar />
        <Link
          href="/admin/precios/formas-de-pago"
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
        >
          <Percent className="h-5 w-5" />
          Formas de pago
        </Link>
        <Link
          href="/admin/precios/listas"
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
        >
          <Tags className="h-5 w-5" />
          Listas
        </Link>
        {ultimo && ultimo.deshacibles > 0 && (
          <DeshacerAjuste
            cuando={fechaHora.format(ultimo.cuando)}
            motivo={ultimo.motivo}
            deshacibles={ultimo.deshacibles}
          />
        )}
        <DialogoAjuste
          categorias={categorias.map((c) => ({ slug: c.slug, name: c.name }))}
          categoriaActual={params.cat ?? "todos"}
          rubros={rubros}
          proveedores={proveedores.map((p) => ({ id: p.id, nombre: p.nombre }))}
        />
      </EncabezadoPanel>

      {/* «Para revisar» son los que no se tocan hace más de DIAS_PARA_REVISAR
          días: lo decide Go, porque depende de la hora y Next no la lee
          durante el render. */}
      <BuscadorProductos
        categorias={categorias}
        busquedaActual={params.buscar ?? ""}
        categoriaActual={params.cat ?? "todos"}
        marcas={marcas}
        marcaActual={params.marca ?? "todas"}
        proveedores={proveedores.map((p) => ({ id: p.id, nombre: p.nombre }))}
        proveedorActual={params.prov ?? "todos"}
        estadoActual={estado}
        estados={[
          { valor: "todos", texto: "Todas", cantidad: conteos.todas },
          { valor: "sin-precio", texto: "Sin precio", cantidad: conteos.sinPrecio, atencion: true },
          { valor: "para-revisar", texto: "Para revisar", cantidad: conteos.paraRevisar, atencion: true },
          { valor: "al-dia", texto: "Actualizados", cantidad: conteos.alDia },
        ]}
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
            <Grilla filas={filas} generalId={general?.id} profesionalId={profesional?.id} />
            <Paginador
              pagina={pagina}
              total={total}
              porPagina={PRECIOS_POR_PAGINA}
              params={params}
            />
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

/**
 * Los precios en tabla: es lo que se compara columna contra columna (la
 * lista contra la profesional, una medida contra la siguiente). En tarjetas
 * de dos columnas con foto de 80 px entraban seis por pantalla y había que
 * leer cada una para ver dos números.
 */
function Grilla({
  filas,
  generalId,
  profesionalId,
}: {
  filas: FilaPrecio[];
  generalId?: string;
  profesionalId?: string;
}) {
  if (filas.length === 0) return null;
  return (
    <div className="tarjeta overflow-x-auto">
      {/* Anchos fijos: las tablas de los tres grupos quedan alineadas. */}
      <table className="w-full min-w-[720px] table-fixed text-base">
        <thead>
          <tr className="border-b text-left text-sm text-muted-foreground">
            <th className="w-14 px-3 py-2.5" />
            <th className="px-3 py-2.5 font-medium">Producto</th>
            <th className="w-48 px-3 py-2.5 font-medium">Código</th>
            <th className="w-36 px-3 py-2.5 text-right font-medium">Lista</th>
            <th className="w-40 px-3 py-2.5 text-right font-medium">Profesional</th>
            <th className="w-32 px-3 py-2.5 text-right font-medium">Cambió</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((fila) => (
            <FilaDePrecio key={fila.variantId} fila={fila} generalId={generalId} profesionalId={profesionalId} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FilaDePrecio({
  fila,
  generalId,
  profesionalId,
}: {
  fila: FilaPrecio;
  generalId?: string;
  profesionalId?: string;
}) {
  return (
    <tr className="border-b border-border/60 last:border-0">
      <td className="px-3 py-1.5">
        <Link
          href={`/admin/productos/${fila.productId}`}
          className="relative block h-10 w-10 overflow-hidden rounded-md bg-muted"
          tabIndex={-1}
        >
          {fila.imagen ? (
            <Image src={fila.imagen} alt="" fill className="object-cover" sizes="40px" />
          ) : (
            <span className="flex h-full items-center justify-center text-muted-foreground">
              <ImageOff className="h-4 w-4" />
            </span>
          )}
        </Link>
      </td>
      <td className="px-3 py-1.5">
        <Link href={`/admin/productos/${fila.productId}`} className="font-medium leading-snug hover:text-brand-orange">
          {fila.producto}
        </Link>
        <span className="block text-sm text-muted-foreground">{fila.medida}</span>
      </td>
      <td className="tabular px-3 py-1.5 text-sm text-muted-foreground">{fila.sku}</td>
      <td className="px-3 py-1.5">
        {generalId && (
          <PrecioEditable variantId={fila.variantId} priceListId={generalId} valor={fila.precioGeneral} />
        )}
      </td>
      <td className="px-3 py-1.5">
        <div className="flex items-center justify-end gap-1.5">
          {fila.brecha !== null && <span className="tabular text-sm text-brand-orange">−{fila.brecha}%</span>}
          {profesionalId && (
            <PrecioEditable variantId={fila.variantId} priceListId={profesionalId} valor={fila.precioProfesional} />
          )}
        </div>
      </td>
      <td className="px-3 py-1.5 text-right text-sm text-muted-foreground">
        {fila.actualizado ? haceCuanto(fila.actualizado) : "—"}
      </td>
    </tr>
  );
}
