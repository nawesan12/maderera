import Image from "next/image";
import Link from "next/link";
import { CreditCard, Download, FileText, ImageOff, Tags } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { leerPagina, Paginador } from "@/components/admin/paginador";
import { fechaHora, formatearMonto, haceCuanto, moneda, plural } from "@/components/admin/formato";
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
  if (params.estado) consulta.set("estado", params.estado);
  if (params.marca) consulta.set("marca", params.marca);
  if (params.prov) consulta.set("prov", params.prov);
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
        {/* Formas de pago y Listas son ajustes, no acciones de todos los
            días: van sin borde, un escalón abajo de Exportar e Importar, y
            «Ajustar precios» manda (comité final). */}
        <Link
          href="/admin/precios/formas-de-pago"
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg px-3 text-base font-medium text-texto-2 transition-colors hover:bg-muted hover:text-foreground"
        >
          {/* La tarjeta y no el %: el % es de «Ajustar precios», a dos
              botones, y el mismo ícono para dos cosas hacía dudar. */}
          <CreditCard className="h-5 w-5" />
          Formas de pago
        </Link>
        <Link
          href="/admin/precios/listas"
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg px-3 text-base font-medium text-texto-2 transition-colors hover:bg-muted hover:text-foreground"
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
                            subio ? "text-brand-orange" : "text-saldo-favor"
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
 *
 * En el teléfono la tabla apilada era una tarjeta de 260 px por medida, con
 * «Código:», «Lista:», «Cambió:» uno abajo del otro: 13.000 px de página.
 * Donde la tabla no entra entera va una lista propia de dos renglones por
 * medida, sin foto ni «Cambió», que en el teléfono no se miran. Lo decide el
 * ancho del bloque (`@container`, 896 px: lo que piden las columnas fijas más
 * el nombre) y no el de la pantalla, porque el menú lateral se come 244 px:
 * con `md` y un ancho mínimo, una tablet o una notebook con el menú abierto
 * corrían la tabla de costado, y eso no pasa en ningún ancho.
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
    <div className="@container">
      <div className="tarjeta hidden overflow-hidden @4xl:block">
        {/* Anchos fijos: las tablas de los tres grupos quedan alineadas. */}
        <table className="w-full table-fixed text-base">
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

      <div className="tarjeta overflow-hidden @4xl:hidden">
        {/* Un solo encabezado arriba y no un rótulo por renglón: los dos
            precios quedan en la misma columna en toda la lista. */}
        <div
          className="grid grid-cols-[1fr_3.25rem_1fr] gap-1.5 border-b px-3 py-2 text-sm font-medium text-muted-foreground"
          aria-hidden="true"
        >
          <span className="text-right">Lista</span>
          <span />
          <span className="text-right">Profesional</span>
        </div>
        <ul className="divide-y divide-border/60">
          {filas.map((fila) => (
            <RenglonDePrecio key={fila.variantId} fila={fila} generalId={generalId} profesionalId={profesionalId} />
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * La brecha es cuánto más barato le sale al profesional. Negativa es un
 * precio profesional por encima del de lista: casi seguro un error de carga,
 * y se marca en rojo en vez de decir «−-107%». La usan la tabla y la lista
 * del teléfono: escrita dos veces, se desfasaban.
 */
function Brecha({ brecha }: { brecha: number | null }) {
  if (brecha === null) return null;
  const texto = Math.abs(brecha).toString().replace(".", ",");
  // Un porcentaje de siete cifras no se lee y se montaba sobre el precio de
  // al lado (mes simulado: «+10719900%» encima de «$100»). Pasado el 100 %
  // es un error de carga: se dice eso.
  return brecha >= 0 ? (
    <span className="tabular whitespace-nowrap text-sm text-brand-orange">−{texto}%</span>
  ) : (
    <span
      className="tabular estado-problema whitespace-nowrap text-sm font-semibold text-[var(--estado-tinta)]"
      title="El precio profesional es más alto que el de lista"
    >
      {brecha < -100 ? "Revisar" : `+${texto}%`}
    </span>
  );
}

/**
 * «Bajo costo» debajo de un precio que no cubre el costo promedio con IVA
 * (mes simulado: el Fenólico 18 mm a $100 con un costo de $75.000 neto, y
 * nada lo decía). El piso lo calcula Go (precios.PisoDeCosto).
 */
function BajoCosto({ precio, piso }: { precio: string; piso?: number | null }) {
  const n = Number(precio);
  if (!piso || !(n > 0) || n >= piso - 0.005) return null;
  return (
    <span
      className="estado-problema block whitespace-nowrap text-right text-sm font-semibold text-[var(--estado-tinta)]"
      title={`Cubre el costo desde ${formatearMonto(piso)}`}
    >
      Bajo costo
    </span>
  );
}

function RenglonDePrecio({
  fila,
  generalId,
  profesionalId,
}: {
  fila: FilaPrecio;
  generalId?: string;
  profesionalId?: string;
}) {
  return (
    <li className="px-3 py-2">
      {/* Lo que separa una medida de otra es la medida: entera, y se corta
          el nombre. */}
      <p className="flex min-w-0 items-baseline gap-2 px-2">
        <Link
          href={`/admin/productos/${fila.productId}`}
          className="min-w-0 flex-1 truncate font-medium hover:text-brand-orange"
        >
          {fila.producto}
        </Link>
        <span className="shrink-0 whitespace-nowrap text-sm text-muted-foreground">{fila.medida}</span>
      </p>
      <div className="mt-0.5 grid grid-cols-[1fr_3.25rem_1fr] items-center gap-1.5">
        <div>
          {generalId && (
            <PrecioEditable variantId={fila.variantId} priceListId={generalId} valor={fila.precioGeneral} rotulo="Lista" tactil />
          )}
          <BajoCosto precio={fila.precioGeneral} piso={fila.piso} />
        </div>
        <div className="text-center">
          <Brecha brecha={fila.brecha} />
        </div>
        <div>
          {profesionalId && (
            <PrecioEditable
              variantId={fila.variantId}
              priceListId={profesionalId}
              valor={fila.precioProfesional}
              rotulo="Profesional"
              tactil
            />
          )}
          <BajoCosto precio={fila.precioProfesional} piso={fila.piso} />
        </div>
      </div>
    </li>
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
          <PrecioEditable variantId={fila.variantId} priceListId={generalId} valor={fila.precioGeneral} rotulo="Lista" />
        )}
        <BajoCosto precio={fila.precioGeneral} piso={fila.piso} />
      </td>
      <td className="px-3 py-1.5">
        {/* La brecha abajo del precio y no al costado: al lado no entraba
            en la columna y pisaba el precio de lista. */}
        <div className="flex flex-col items-end">
          {profesionalId && (
            <PrecioEditable variantId={fila.variantId} priceListId={profesionalId} valor={fila.precioProfesional} rotulo="Profesional" />
          )}
          <Brecha brecha={fila.brecha} />
          <BajoCosto precio={fila.precioProfesional} piso={fila.piso} />
        </div>
      </td>
      <td className="px-3 py-1.5 text-right text-sm text-muted-foreground">
        {fila.actualizado ? haceCuanto(fila.actualizado) : "—"}
      </td>
    </tr>
  );
}
