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
import { BajaDelProveedor } from "./baja";

export const metadata: Metadata = { title: "Proveedor" };

const MEDIOS: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  debito: "Débito",
  credito: "Crédito",
  cheque: "Cheque",
};

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
  const inactivo = proveedor.estado === "inactivo";

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
            {/* Dado de baja, la ficha lo dice (mes 23): no había rastro. */}
            {inactivo && (
              <span className="mt-1 inline-block rounded-full bg-muted px-2.5 py-0.5 text-sm font-medium text-muted-foreground">
                Inactivo
              </span>
            )}
            {/* La razón social en su renglón y el CUIT entero, sin partirse
                (M2S2-081: «…SRL · 30-» / «71555040-3»). */}
            {proveedor.razonSocial && proveedor.razonSocial !== proveedor.nombre && (
              <p className="mt-1 text-base text-muted-foreground">{proveedor.razonSocial}</p>
            )}
            <p className="mt-0.5 text-base text-muted-foreground">
              {proveedor.cuit && <span className="tabular whitespace-nowrap">{proveedor.cuit}</span>}
              {proveedor.cuit && " · "}
              <span className="whitespace-nowrap">
                {proveedor.diasPago === 0 ? "pago contra entrega" : `pago a ${proveedor.diasPago} días`}
              </span>
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
            {/* Al inactivo se le paga solo lo que se le debe, como en Pagos. */}
            {(!inactivo || proveedor.saldo > 0.005) && (
              // Sin deuda, el pago (un anticipo) queda como secundario: el
              // naranja al lado de «$ 0» pedía pagar lo que no se debe (M4-045).
              <Link
                href={`/admin/compras/pagos?proveedor=${proveedor.id}`}
                className={`inline-flex h-12 items-center rounded-xl px-6 text-base font-semibold ${
                  proveedor.saldo > 0.005 ? "boton-accion" : "tarjeta-hundida font-medium"
                }`}
              >
                Pagar
              </Link>
            )}
          </div>
        </header>
      </div>

      {(proveedor.contacto || proveedor.telefono || proveedor.email || proveedor.direccion || proveedor.cbu || proveedor.aliasCbu) && (
        <section className="tarjeta grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Dato titulo="Contacto" valor={proveedor.contacto} />
          <Dato titulo="Teléfono" valor={proveedor.telefono} />
          {/* El correo es al que sale la orden «Por correo» (M4-008). */}
          {proveedor.email && <Dato titulo="Correo" valor={proveedor.email} />}
          {proveedor.direccion && <Dato titulo="Dirección" valor={proveedor.direccion} />}
          {/* Cada dato con su nombre: el alias salía bajo «CBU». */}
          {proveedor.cbu && <Dato titulo="CBU" valor={proveedor.cbu} mono />}
          {proveedor.aliasCbu && <Dato titulo="Alias" valor={proveedor.aliasCbu} mono />}
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
              const nota = f.tipo.startsWith("nota_credito");
              const cheque = f.tipo === "cheque_rechazado";
              const ajuste = f.tipo === "ajuste";
              const nombre = (
                <>
                  <span className="codigo block font-medium">{nota ? `Nota de crédito ${f.numero}` : f.numero}</span>
                  <span className="block text-sm text-muted-foreground">
                    {cheque ? "Rechazado" : `del ${fechaCorta.format(new Date(f.fechaEmision))}`}
                  </span>
                </>
              );
              return (
                <li key={f.id} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3">
                  {ajuste ? (
                    <span className="min-w-0 flex-1">{nombre}</span>
                  ) : (
                    <Link
                      href={cheque ? "/admin/cheques" : `/admin/compras/facturas/${f.id}`}
                      className="min-w-0 flex-1 hover:underline"
                    >
                      {nombre}
                    </Link>
                  )}
                  {!nota && !cheque && !ajuste && (
                    <span className={`tabular text-base ${vencida ? "font-semibold text-saldo-debe" : dias === 0 ? "font-semibold text-brand-orange-dark" : "text-muted-foreground"}`}>
                      {vence ? (dias === 0 ? "vence hoy" : `${vencida ? "venció" : "vence"} el ${fechaCorta.format(vence)}`) : "sin vencimiento"}
                    </span>
                  )}
                  <span className={`tabular w-32 text-right text-base font-semibold ${nota ? "text-saldo-favor" : ""}`}>
                    {nota ? `−${formatearMonto(f.saldo)}` : formatearMonto(f.saldo)}
                  </span>
                  <Link
                    href={
                      nota
                        ? `/admin/compras/facturas/${f.id}`
                        : `/admin/compras/pagos?proveedor=${proveedor.id}&${cheque ? "cheque" : "factura"}=${f.id}`
                    }
                    className="tarjeta-hundida inline-flex h-10 items-center rounded-xl px-4 text-base font-medium"
                  >
                    {nota ? "Aplicar" : "Pagar"}
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
        facturas={pendientes
          .filter((f) => !f.tipo.startsWith("nota_credito") && f.tipo !== "cheque_rechazado")
          .map((f) => ({ id: f.id, numero: f.numero, saldo: f.saldo, ajuste: f.tipo === "ajuste" }))}
      />

      {/* Lo pagado en el acto (un flete, la luz): no pasa por la cuenta, pero
          es plata que se le pagó (mes simulado, H065). */}
      {proveedor.gastos.length > 0 && (
        <section className="tarjeta overflow-hidden">
          <h2 className="flex items-baseline gap-2 px-5 pt-5 text-[19px] font-bold tracking-tight">
            Pagado en el acto
            <span className="tabular text-base font-medium text-muted-foreground">
              {formatearMonto(proveedor.gastos.reduce((t, g) => t + g.importe, 0))}
            </span>
          </h2>
          <ul className="mt-2 divide-y divide-linea">
            {proveedor.gastos.map((g) => (
              <li key={g.id} className="flex items-baseline justify-between gap-3 px-5 py-3">
                <span className="min-w-0">
                  <span className="block">{g.descripcion}</span>
                  <span className="tabular block text-sm text-muted-foreground">
                    {fechaCorta.format(new Date(g.fecha))} · {MEDIOS[g.medio] ?? g.medio}
                    {g.factura && ` · factura ${g.factura}`}
                  </span>
                </span>
                <span className="tabular shrink-0 font-semibold">{formatearMonto(g.importe)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <CondicionesDelProveedor
        supplierId={proveedor.id}
        condiciones={condiciones}
        convenios={proveedor.convenios}
        diasPago={proveedor.diasPago}
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
          {proveedor.estado !== "inactivo" && <BajaDelProveedor id={proveedor.id} nombre={proveedor.nombre} />}
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
    <div className="min-w-0">
      <p className="text-sm text-muted-foreground">{titulo}</p>
      <p className={`text-base [overflow-wrap:anywhere] ${mono ? "tabular" : ""}`}>{valor ?? "—"}</p>
    </div>
  );
}
