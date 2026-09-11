import type { Metadata } from "next";
import Link from "next/link";
import {
  Building2,
  Clock,
  DollarSign,
  MapPin,
  Package,
  PackageX,
  Phone,
  Scissors,
  Truck,
  Users,
} from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { formatearMonto } from "@/lib/formato";
import {
  sinSucursalAsignada,
  sucursalesConMetricas,
  type SucursalConMetricas,
} from "@/lib/dal/admin/sucursales";

export const metadata: Metadata = { title: "Sucursales" };

/**
 * Sucursales: la ficha que ve el público y los números del día.
 *
 * Era la última pantalla de maqueta del panel: mostraba métricas inventadas.
 * Ahora los números salen de la base.
 *
 * **La ficha publicada no se edita acá y no es un olvido.** Dirección, teléfono
 * y horario viven en `lib/sucursales.ts`, como constantes: son dos locales de
 * siempre y su domicilio no es un dato operativo. El comentario que decía que
 * se editaban desde esta pantalla quedó de una versión anterior y era falso
 * —no hay ni hubo formulario—; el razonamiento está escrito en ese archivo.
 *
 * Los números son del día, no del mes: esta pantalla se abre para saber cómo
 * viene la jornada en cada local. El acumulado del mes está en el resumen.
 *
 * **Cada número lleva a donde se resuelve.** Mostraba seis métricas por
 * sucursal —incluidos "cortes en cola" y "para reponer", que son trabajo
 * pendiente— y ninguna era clickeable: había que leer el número, ir al menú y
 * volver a filtrar por sucursal a mano.
 */
export default async function AdminSucursalesPage() {
  const [sucursales, sueltos] = await Promise.all([
    sucursalesConMetricas(),
    sinSucursalAsignada(),
  ]);

  return (
    <div className="space-y-6">
      <EncabezadoPanel
        titulo="Sucursales"
        detalle="Cómo viene el día en cada local, y la ficha que se publica en el sitio."
      >
        <Link
          href="/sucursales"
          target="_blank"
          className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted"
        >
          <Building2 className="h-5 w-5" />
          Ver en el sitio
        </Link>
      </EncabezadoPanel>

      {sucursales.length === 0 && (
        <p className="rounded-lg border border-dashed px-4 py-10 text-center text-base text-muted-foreground">
          Todavía no hay sucursales cargadas.
        </p>
      )}

      <div className="grid gap-6 2xl:grid-cols-2">
        {sucursales.map((suc) => (
          <TarjetaSucursal key={suc.id} sucursal={suc} />
        ))}
      </div>

      {(sueltos.pedidos > 0 || sueltos.cortes > 0) && (
        <p className="rounded-lg border bg-muted/40 px-4 py-3 text-base text-muted-foreground">
          Sin sucursal asignada:{" "}
          <strong className="text-foreground">{sueltos.pedidos}</strong>{" "}
          {sueltos.pedidos === 1 ? "pedido abierto" : "pedidos abiertos"} y{" "}
          <strong className="text-foreground">{sueltos.cortes}</strong>{" "}
          {sueltos.cortes === 1 ? "corte en cola" : "cortes en cola"}. No suman a
          ninguna de las dos columnas de arriba.
        </p>
      )}
    </div>
  );
}

function TarjetaSucursal({ sucursal }: { sucursal: SucursalConMetricas }) {
  const metricas = [
    {
      icono: DollarSign,
      etiqueta: "Vendido hoy",
      valor: formatearMonto(sucursal.ventasHoy),
      href: `/admin/pedidos?sucursal=${sucursal.slug}`,
    },
    {
      icono: Truck,
      etiqueta: "Pedidos hoy",
      valor: String(sucursal.pedidosHoy),
      pie:
        sucursal.pedidosAbiertos > 0
          ? `${sucursal.pedidosAbiertos} sin entregar`
          : undefined,
      href: `/admin/pedidos?sucursal=${sucursal.slug}`,
    },
    {
      icono: Scissors,
      etiqueta: "Cortes en cola",
      valor: String(sucursal.cortesEnCola),
      atencion: sucursal.cortesEnCola > 0,
      href: "/admin/cortes",
    },
    {
      icono: Users,
      etiqueta: "Clientes atendidos",
      valor: String(sucursal.clientesAtendidos),
      href: "/admin/clientes",
    },
    {
      icono: Package,
      etiqueta: "Stock valorizado",
      valor: formatearMonto(sucursal.stockValor),
      href: "/admin/stock",
    },
    {
      icono: PackageX,
      etiqueta: "Para reponer",
      valor: String(sucursal.productosStockBajo),
      atencion: sucursal.productosStockBajo > 0,
      href: `/admin/reportes/reposicion?sucursal=${sucursal.slug}`,
    },
  ];

  return (
    <article className="tarjeta overflow-hidden">
      <header className="flex items-start gap-4 border-b p-5">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-brand-orange/12 text-brand-orange">
          <Building2 className="h-7 w-7" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold">{sucursal.nombre}</h2>
            {!sucursal.active && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-sm text-muted-foreground">
                No se publica
              </span>
            )}
          </div>

          <ul className="mt-1.5 space-y-1 text-base text-muted-foreground">
            {sucursal.direccion && (
              <li className="flex items-start gap-1.5">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{sucursal.direccion}</span>
              </li>
            )}
            {sucursal.telefono && (
              <li className="flex items-center gap-1.5">
                <Phone className="h-4 w-4 shrink-0" />
                <span className="tabular">{sucursal.telefono}</span>
              </li>
            )}
            {sucursal.horario && (
              <li className="flex items-start gap-1.5">
                <Clock className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{sucursal.horario}</span>
              </li>
            )}
          </ul>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3">
        {metricas.map((m) => (
          <Link
            key={m.etiqueta}
            href={m.href}
            className="bg-card p-4 transition-colors hover:bg-hundida"
          >
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <m.icono className="h-4 w-4" aria-hidden="true" />
              <span className="text-sm">{m.etiqueta}</span>
            </span>
            <span
              className={`tabular mt-1.5 block text-xl font-semibold ${
                m.atencion ? "text-brand-orange" : ""
              }`}
            >
              {m.valor}
            </span>
            {m.pie && (
              <span className="mt-0.5 block text-sm text-muted-foreground">
                {m.pie}
              </span>
            )}
          </Link>
        ))}
      </div>

    </article>
  );
}
