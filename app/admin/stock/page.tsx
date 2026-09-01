import Image from "next/image";
import Link from "next/link";
import { ImageOff, Package } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { GrupoListado } from "@/components/admin/grupo";
import { recortar, VerTodo } from "@/components/admin/ver-mas";
import { NivelStock } from "@/components/admin/nivel-stock";
import { fechaHora, plural } from "@/components/admin/formato";
import { BuscadorProductos } from "@/app/admin/productos/buscador";
import { listarCategoriasAdmin } from "@/lib/dal/admin/products";
import {
  listarStock,
  listarSucursales,
  ultimosMovimientos,
  type FilaStock,
} from "@/lib/dal/admin/inventory";
import { AjusteRapido } from "./ajuste-rapido";
import { DialogoTransferencia } from "./dialogo-transferencia";

const etiquetaMovimiento: Record<string, string> = {
  ingreso: "Ingreso",
  egreso: "Egreso",
  ajuste: "Ajuste",
  transferencia_salida: "Salida",
  transferencia_entrada: "Entrada",
  venta: "Venta",
  devolucion: "Devolución",
};

export default async function AdminStockPage({
  searchParams,
}: {
  searchParams: Promise<{ buscar?: string; cat?: string; ver?: string }>;
}) {
  const params = await searchParams;

  const [filas, categorias, sucursales, movimientos] = await Promise.all([
    listarStock({ busqueda: params.buscar, categoria: params.cat }),
    listarCategoriasAdmin(),
    listarSucursales(),
    ultimosMovimientos(8),
  ]);

  // Tres grupos, en el orden en que se atienden: lo que no hay, lo que se está
  // por acabar y lo que está bien.
  const agotados = filas.filter((f) => f.total === 0);
  const reponer = filas.filter(
    (f) =>
      f.total > 0 &&
      (f.nivelCentral === "bajo" || f.nivelAserradero === "bajo"),
  );
  const normales = filas.filter(
    (f) => !agotados.includes(f) && !reponer.includes(f),
  );

  // Los tres grupos se recortan, incluidos los que piden atención: con
  // trescientas variantes bajo el mínimo, el grupo urgente es el más largo.
  const verTodo = params.ver === "todo";
  const sinStock = recortar(agotados, verTodo);
  const aReponer = recortar(reponer, verTodo);
  const conStock = recortar(normales, verTodo);

  return (
    <div>
      <EncabezadoPanel
        titulo="Stock"
        detalle={
          reponer.length + agotados.length > 0
            ? `${plural(reponer.length + agotados.length, "medida")} para atender de ${filas.length}`
            : `${plural(filas.length, "medida")} en inventario`
        }
      >
        <DialogoTransferencia
          variantes={filas.map((f) => ({
            id: f.variantId,
            texto: `${f.productName} — ${f.label}`,
          }))}
          sucursales={sucursales.map((s) => ({ id: s.id, name: s.name }))}
        />
      </EncabezadoPanel>

      <BuscadorProductos
        categorias={categorias}
        busquedaActual={params.buscar ?? ""}
        categoriaActual={params.cat ?? "todos"}
      />

      {filas.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed py-16 text-center">
          <Package className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-base font-medium">Ninguna medida coincide</p>
          <p className="mt-1 text-base text-muted-foreground">
            Probá con otro nombre, código o categoría.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid gap-6 2xl:grid-cols-[1fr_320px]">
          <div>
            <GrupoListado
              titulo="Sin stock"
              cantidad={agotados.length}
              detalle="No hay en ninguna sucursal"
              destacado
            >
              <Grilla filas={sinStock.visibles} />
              <VerTodo ocultas={sinStock.ocultas} params={params} />
            </GrupoListado>

            <GrupoListado
              titulo="Hay que reponer"
              cantidad={reponer.length}
              detalle="Por debajo del mínimo"
              destacado
            >
              <Grilla filas={aReponer.visibles} />
              <VerTodo ocultas={aReponer.ocultas} params={params} />
            </GrupoListado>

            <GrupoListado titulo="Con stock" cantidad={normales.length}>
              <Grilla filas={conStock.visibles} />
              <VerTodo ocultas={conStock.ocultas} params={params} />
            </GrupoListado>
          </div>

          <aside className="2xl:sticky 2xl:top-24 2xl:self-start">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Últimos movimientos
            </h2>
            {movimientos.length === 0 ? (
              <p className="rounded-xl border border-dashed px-3 py-6 text-center text-base text-muted-foreground">
                Todavía no se registró ningún movimiento.
              </p>
            ) : (
              <ul className="tarjeta-hundida overflow-hidden">
                {movimientos.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-baseline justify-between gap-3 border-b border-border/60 px-3 py-3 last:border-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-base">{m.productName}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {m.label}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {etiquetaMovimiento[m.type] ?? m.type} · {m.branchName}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {fechaHora.format(m.createdAt)}
                      </p>
                    </div>
                    <span
                      className={`tabular shrink-0 text-base font-medium ${
                        m.qty > 0 ? "text-green-700" : "text-muted-foreground"
                      }`}
                    >
                      {m.qty > 0 ? `+${m.qty}` : m.qty}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function Grilla({ filas }: { filas: FilaStock[] }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {filas.map((fila) => (
        <TarjetaStock key={fila.variantId} fila={fila} />
      ))}
    </div>
  );
}

function TarjetaStock({ fila }: { fila: FilaStock }) {
  const necesitaAtencion =
    fila.total === 0 ||
    fila.nivelCentral === "bajo" ||
    fila.nivelAserradero === "bajo";

  return (
    <article
      className={`flex gap-4 p-4 ${
        necesitaAtencion ? "tarjeta-atencion" : "tarjeta"
      }`}
    >
      <Link
        href={`/admin/productos/${fila.productId}`}
        className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-muted"
      >
        {fila.imagen ? (
          <Image
            src={fila.imagen}
            alt={fila.productName}
            fill
            className="object-cover"
            sizes="96px"
          />
        ) : (
          <span className="flex h-full items-center justify-center text-muted-foreground">
            <ImageOff className="h-5 w-5" />
          </span>
        )}
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              href={`/admin/productos/${fila.productId}`}
              className="text-base font-medium leading-snug hover:text-brand-orange"
            >
              {fila.productName}
            </Link>
            <p className="text-sm text-muted-foreground">{fila.label}</p>
            <p className="tabular text-sm text-muted-foreground">{fila.sku}</p>
          </div>
          <p className="tabular shrink-0 text-right">
            <span className="block text-xl font-semibold">{fila.total}</span>
            <span className="block text-sm text-muted-foreground">total</span>
          </p>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <NivelStock
              sucursal="Casa Central"
              cantidad={fila.qtyCentral}
              reservado={fila.reservadoCentral}
              minimo={fila.minCentral}
              nivel={fila.nivelCentral}
              unidad={fila.unidad}
            />
            <div className="mt-2">
              <AjusteRapido
                variantId={fila.variantId}
                branchSlug="casa-central"
                sucursal="Casa Central"
              />
            </div>
          </div>

          <div>
            <NivelStock
              sucursal="Aserradero"
              cantidad={fila.qtyAserradero}
              reservado={fila.reservadoAserradero}
              minimo={fila.minAserradero}
              nivel={fila.nivelAserradero}
              unidad={fila.unidad}
            />
            <div className="mt-2">
              <AjusteRapido
                variantId={fila.variantId}
                branchSlug="aserradero"
                sucursal="Aserradero"
              />
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
