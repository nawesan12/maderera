import type { Metadata } from "next";
import Link from "next/link";
import { Receipt } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { SelectorDeMes } from "@/components/admin/selector-de-mes";
import { Vacio } from "@/components/admin/vacio";
import { ETIQUETA_CIRCUITO } from "@/lib/db/schema/circuito";
import { FiltroDeCircuito } from "./filtro";
import { requireStaffRole } from "@/lib/dal/session";
import {
  gastosPorCategoria,
  gastosPorCircuito,
  listarGastos,
  sucursalesParaGasto,
} from "@/lib/dal/admin/gastos";
import { proveedoresParaElegir } from "@/lib/dal/admin/proveedores";
import { leerPeriodoMensual } from "@/lib/periodos";
import { formatearMonto } from "@/lib/formato";
import { CargarGasto } from "./cargar";

export const metadata: Metadata = { title: "Gastos" };

const CATEGORIAS: Record<string, string> = {
  flete: "Fletes",
  combustible: "Combustible",
  servicios: "Servicios",
  alquiler: "Alquiler",
  sueldos: "Sueldos",
  mantenimiento: "Mantenimiento",
  impuestos: "Impuestos",
  librería: "Librería",
  publicidad: "Publicidad",
  otros: "Otros",
};

/**
 * Los gastos, con su enganche a la caja.
 *
 * Existe porque lo más cercano que había era el `retiro` de caja, que además
 * exige turno abierto: un gasto pagado por transferencia un domingo no tenía
 * dónde anotarse, y uno pagado en efectivo quedaba como "retiro" sin
 * clasificar. Al cierre del mes nadie podía decir cuánto se gastó en fletes.
 */
export default async function GastosPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; circuito?: string }>;
}) {
  await requireStaffRole("admin");

  const { periodo: crudo, circuito = "todos" } = await searchParams;
  const periodo = leerPeriodoMensual(crudo, new Date());

  const [todos, porCategoria, porCircuito, sucursales, proveedores] =
    await Promise.all([
      listarGastos({ desde: periodo.desde, hasta: periodo.hasta }),
      gastosPorCategoria(periodo.desde, periodo.hasta),
      gastosPorCircuito(periodo.desde, periodo.hasta),
      sucursalesParaGasto(),
      proveedoresParaElegir(),
    ]);

  const gastos =
    circuito === "todos" ? todos : todos.filter((g) => g.circuito === circuito);

  const etiqueta = new Date(periodo.anio, periodo.mes - 1, 1).toLocaleDateString(
    "es-AR",
    { month: "long", year: "numeric" },
  );
  const total = porCategoria.reduce((s, c) => s + Number(c.total), 0);

  return (
    <div className="space-y-6">
      <EncabezadoPanel
        titulo="Gastos"
        detalle={
          total > 0
            ? `${formatearMonto(total)} en ${etiqueta}.`
            : `Sin gastos anotados en ${etiqueta}.`
        }
      >
        <SelectorDeMes actual={periodo.clave} />
      </EncabezadoPanel>

      <FiltroDeCircuito actual={circuito} />

      {/* Los dos circuitos, uno al lado del otro.

          Es el número por el que se pidió la columna: el total del mes sumado
          no contesta nada si la mitad salió por cada lado. */}
      {porCircuito.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {(["blanco", "negro"] as const).map((c) => {
            const fila = porCircuito.find((x) => x.circuito === c);
            return (
              <article key={c} className="tarjeta p-4">
                <p className="text-sm text-muted-foreground">
                  {ETIQUETA_CIRCUITO[c]} · {etiqueta}
                </p>
                <p className="tabular mt-0.5 text-2xl font-bold">
                  {formatearMonto(Number(fila?.total ?? 0))}
                </p>
                <p className="text-sm text-muted-foreground">
                  {fila?.cantidad ?? 0} gasto
                  {(fila?.cantidad ?? 0) === 1 ? "" : "s"}
                </p>
              </article>
            );
          })}
        </div>
      )}

      {porCategoria.length > 0 && (
        <section className="tarjeta overflow-hidden">
          <header className="border-b border-linea px-5 py-3.5">
            <h2 className="text-base font-semibold">
              Por categoría · {etiqueta}
            </h2>
          </header>
          <ul className="divide-y divide-linea">
            {porCategoria.map((c) => (
              <li
                key={c.categoria}
                className="flex items-center gap-3 px-5 py-2.5"
              >
                <span className="min-w-0 flex-1">
                  {CATEGORIAS[c.categoria] ?? c.categoria}
                  <span className="ml-2 text-sm text-muted-foreground">
                    ({c.cantidad})
                  </span>
                </span>
                {/* La barra vale más que el porcentaje solo: el ojo encuentra
                    la categoría que se lleva la mitad sin leer números. */}
                <span className="hidden h-1.5 w-32 overflow-hidden rounded-full bg-hundida sm:block">
                  <span
                    className="block h-full rounded-full bg-accion"
                    style={{ width: `${(Number(c.total) / total) * 100}%` }}
                  />
                </span>
                <span className="tabular shrink-0 font-semibold">
                  {formatearMonto(Number(c.total))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <CargarGasto
        sucursales={sucursales.map((s) => ({
          id: s.id,
          nombre: s.nombre,
          conTurno: Boolean(s.turnoAbierto),
        }))}
        proveedores={proveedores.map((p) => ({ id: p.id, nombre: p.nombre }))}
      />

      <section className="tarjeta overflow-hidden">
        {gastos.length === 0 ? (
          <Vacio
            icono={Receipt}
            titulo={`Sin gastos en ${etiqueta}`}
            detalle="Los gastos de otro mes se miran cambiando el mes de arriba."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-base">
              <thead>
                <tr className="border-b border-linea text-left text-sm uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-2.5 font-semibold">Fecha</th>
                  <th className="px-5 py-2.5 font-semibold">Categoría</th>
                  <th className="px-5 py-2.5 font-semibold">En qué</th>
                  <th className="px-5 py-2.5 font-semibold">Medio</th>
                  <th className="px-5 py-2.5 font-semibold">Circuito</th>
                  <th className="px-5 py-2.5 text-right font-semibold">
                    Importe
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-linea">
                {gastos.map((g) => (
                  <tr key={g.id}>
                    <td className="tabular px-5 py-3 text-muted-foreground">
                      {g.fecha.toLocaleDateString("es-AR")}
                    </td>
                    <td className="px-5 py-3">
                      {CATEGORIAS[g.categoria] ?? g.categoria}
                    </td>
                    <td className="px-5 py-3">
                      {g.descripcion}
                      {g.proveedor && (
                        /* El gasto suele ser la punta del ovillo: "esto se lo
                           pagamos a Maderas del Sur, ¿qué más le debemos?" */
                        <Link
                          href={`/admin/proveedores/${g.supplierId}`}
                          className="block text-sm text-muted-foreground hover:text-brand-orange hover:underline"
                        >
                          {g.proveedor}
                        </Link>
                      )}
                      {g.sucursal && (
                        <span className="block text-sm text-muted-foreground">
                          {g.sucursal}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {g.medio}
                      {g.enCaja && (
                        <span className="block text-sm">salió de la caja</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-sm font-medium ${
                          g.circuito === "negro"
                            ? "bg-chip text-texto-2"
                            : "bg-naranja-claro text-acento-sobre-claro"
                        }`}
                      >
                        {ETIQUETA_CIRCUITO[g.circuito] ?? g.circuito}
                      </span>
                      {/* Con factura o sin factura: es otra pregunta, y la
                          columna estaba en la base sin mostrarse nunca. */}
                      <span className="mt-0.5 block text-sm text-muted-foreground">
                        {g.conFactura ? "con factura" : "sin factura"}
                      </span>
                    </td>
                    <td className="tabular px-5 py-3 text-right font-semibold">
                      {formatearMonto(Number(g.importe))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
