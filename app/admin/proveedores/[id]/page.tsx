import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { esUuid } from "@/lib/uuid";
import { ArrowLeft } from "lucide-react";
import { facturasConSaldo } from "@/lib/dal/admin/pagos-proveedor";
import { diasHasta, fechaCorta } from "@/lib/formato";
import { requireStaffRole } from "@/lib/dal/session";
import {
  condicionesDelProveedor,
  obtenerProveedor,
  perfilDelProveedor,
} from "@/lib/dal/admin/proveedores";
import { CondicionesDelProveedor } from "./condiciones";
import { ImportadorDeLista } from "../lista-precios/importador";
import { formatearMonto } from "@/lib/formato";
import { FormularioProveedor } from "../formulario";
import { CuentaDelProveedor } from "./cuenta";

export const metadata: Metadata = { title: "Proveedor" };

/**
 * La ficha del proveedor y su cuenta corriente.
 *
 * Arriba, lo que se viene a hacer: cuánto se le debe, el botón de pagarle
 * (abre el pago con él ya elegido) y las facturas pendientes por
 * vencimiento, cada una con su vencimiento. Después el libro, donde cada
 * renglón lleva a su factura o a su pago.
 *
 * El libro está arriba y la ficha abajo, plegada, por la misma razón que en
 * sucursales: los datos de un proveedor cambian dos veces por año y el saldo se
 * mira todas las semanas. Un formulario desplegado empujaría fuera de pantalla
 * lo único que se viene a ver.
 */
export default async function ProveedorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireStaffRole("admin");

  const { id } = await params;

  if (!esUuid(id)) notFound();
  const [proveedor, perfil, condiciones, pendientes] = await Promise.all([
    obtenerProveedor(id),
    perfilDelProveedor(id),
    condicionesDelProveedor(id),
    facturasConSaldo(id),
  ]);

  if (!proveedor) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/proveedores"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Proveedores
        </Link>

        <header className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[26px] font-bold tracking-tight">
              {proveedor.nombre}
            </h1>
            <p className="mt-1 text-base text-muted-foreground">
              {[
                proveedor.razonSocial,
                proveedor.cuit,
                proveedor.diasPago === 0
                  ? "pago contra entrega"
                  : `pago a ${proveedor.diasPago} días`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Se le debe</p>
              <p
                className={`tabular text-3xl font-bold ${
                  proveedor.saldo > 0.005
                    ? "text-saldo-debe"
                    : proveedor.saldo < -0.005
                      ? "text-saldo-favor"
                      : "text-saldo-cero"
                }`}
              >
                {formatearMonto(proveedor.saldo)}
              </p>
            </div>
            <Link
              href={`/admin/compras/pagos?proveedor=${proveedor.id}`}
              className="boton-accion inline-flex h-12 items-center rounded-xl px-6 text-base font-semibold"
            >
              Pagar
            </Link>
          </div>
        </header>
      </div>

      {(proveedor.contacto || proveedor.telefono || proveedor.cbu) && (
        <section className="tarjeta grid gap-4 p-4 sm:grid-cols-3">
          <Dato titulo="Contacto" valor={proveedor.contacto} />
          <Dato titulo="Teléfono" valor={proveedor.telefono} />
          <Dato
            titulo="CBU"
            valor={proveedor.cbu ?? proveedor.aliasCbu}
            mono
          />
        </section>
      )}

      {pendientes.length > 0 && (
        <section className="tarjeta overflow-hidden">
          <h2 className="flex items-baseline gap-2 px-5 pt-5 text-[19px] font-bold tracking-tight">
            Facturas por pagar
            <span className="tabular text-base font-medium text-muted-foreground">{pendientes.length}</span>
          </h2>
          <ul className="mt-2 divide-y divide-linea">
            {pendientes.map((f) => {
              const vence = f.fechaVencimiento ? new Date(f.fechaVencimiento) : null;
              const dias = diasHasta(vence);
              const vencida = dias !== null && dias < 0;
              return (
                <li key={f.id} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3">
                  <Link href={`/admin/compras/facturas/${f.id}`} className="min-w-0 flex-1 hover:underline">
                    <span className="tabular block font-medium">{f.numero}</span>
                    <span className="block text-sm text-muted-foreground">
                      del {fechaCorta.format(f.fechaEmision)}
                    </span>
                  </Link>
                  <span className={`tabular text-base ${vencida ? "font-semibold text-saldo-debe" : "text-muted-foreground"}`}>
                    {vence ? `${vencida ? "venció" : "vence"} el ${fechaCorta.format(vence)}` : "sin vencimiento"}
                  </span>
                  <span className="tabular w-32 text-right text-base font-semibold">{formatearMonto(f.saldo)}</span>
                  <Link
                    href={`/admin/compras/pagos?proveedor=${proveedor.id}&factura=${f.id}`}
                    className="tarjeta-hundida inline-flex h-10 items-center rounded-xl px-4 text-base font-medium"
                  >
                    Pagar
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <CuentaDelProveedor
        supplierId={proveedor.id}
        movimientos={proveedor.movimientos}
      />

      <CondicionesDelProveedor
        supplierId={proveedor.id}
        condiciones={condiciones}
        convenios={proveedor.convenios}
      />

      <details className="tarjeta p-5">
        <summary className="cursor-pointer text-base font-semibold">
          Editar la ficha
        </summary>
        <div className="mt-4">
          <FormularioProveedor
            ficha={{
              id: proveedor.id,
              nombre: proveedor.nombre,
              razonSocial: proveedor.razonSocial,
              cuit: proveedor.cuit,
              condicionIva: proveedor.condicionIva,
              contacto: proveedor.contacto,
              telefono: proveedor.telefono,
              email: proveedor.email,
              direccion: proveedor.direccion,
              rubro: proveedor.rubro,
              cbu: proveedor.cbu,
              aliasCbu: proveedor.aliasCbu,
              diasPago: proveedor.diasPago,
              notas: proveedor.notas,
              condicionGanancias: proveedor.condicionGanancias,
              exentoGananciasHasta: proveedor.exentoGananciasHasta,
            }}
          />
        </div>
      </details>

      <ImportadorDeLista
        supplierId={id}
        perfil={
          perfil
            ? {
                columnaCodigo: perfil.columnaCodigo,
                columnaPrecio: perfil.columnaPrecio,
                columnaDescripcion: perfil.columnaDescripcion,
                precioEsNeto: perfil.precioEsNeto,
                margenPorcentaje: perfil.margenPorcentaje,
              }
            : null
        }
      />
    </div>
  );
}

function Dato({
  titulo,
  valor,
  mono,
}: {
  titulo: string;
  valor: string | null;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{titulo}</p>
      <p className={`text-base ${mono ? "tabular" : ""}`}>{valor ?? "—"}</p>
    </div>
  );
}
