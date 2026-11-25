import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, UserPlus } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { listarVendedores } from "@/lib/dal/admin/vendedores";
import { EditorDeVendedor, FilaDeVendedor } from "./editor";
import { Vacio } from "@/components/admin/vacio";

export const metadata: Metadata = { title: "Vendedores" };

/**
 * Los vendedores de la casa, de salón y de calle.
 *
 * La clienta: "hay clientes que se cargan con un vendedor asignado (o sea que
 * hay vendedores, y vendedores de calle)". La ficha del cliente los asigna, el
 * presupuesto y el pedido los heredan, y el reporte de ventas agrupa por
 * ellos. Acá solo se administra quiénes son.
 */
export default async function VendedoresPage() {
  const vendedores = await listarVendedores();
  const activos = vendedores.filter((v) => v.activo);
  const inactivos = vendedores.filter((v) => !v.activo);

  return (
    <div className="space-y-6">
      <Link
        href="/admin/clientes"
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
        Volver a clientes
      </Link>

      <EncabezadoPanel
        titulo="Vendedores"
      />

      {/* El vendedor asignado sale en el presupuesto impreso y ordena el reporte
          de ventas. Uno que se va se desactiva, no se borra: sus ventas
          históricas lo siguen nombrando. */}

      <section className="tarjeta p-5">
        <h2 className="text-base font-semibold">
          Activos
          <span className="tabular ml-2 text-muted-foreground">
            {activos.length}
          </span>
        </h2>
        {activos.length === 0 ? (
          <Vacio
            icono={UserPlus}
            titulo="Todavía no hay vendedores cargados"
            // Se asigna a la ficha del cliente, y los presupuestos y pedidos lo heredan solos.
            accion={{ texto: "Agregar el primero", href: "#agregar" }}
          />
        ) : (
          <ul className="mt-3 divide-y divide-linea-tenue">
            {activos.map((v) => (
              <FilaDeVendedor key={v.id} vendedor={v} />
            ))}
          </ul>
        )}
      </section>

      {inactivos.length > 0 && (
        <section className="tarjeta-hundida p-5">
          <h2 className="text-base font-semibold text-muted-foreground">
            Inactivos
            <span className="tabular ml-2">{inactivos.length}</span>
          </h2>
          <ul className="mt-3 divide-y divide-linea-tenue">
            {inactivos.map((v) => (
              <FilaDeVendedor key={v.id} vendedor={v} />
            ))}
          </ul>
        </section>
      )}

      <section id="agregar" className="space-y-2">
        <h2 className="text-base font-semibold">Agregar un vendedor</h2>
        <EditorDeVendedor />
      </section>
    </div>
  );
}
