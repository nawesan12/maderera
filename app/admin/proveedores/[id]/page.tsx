import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireStaffRole } from "@/lib/dal/session";
import { obtenerProveedor } from "@/lib/dal/admin/proveedores";
import { formatearMonto } from "@/lib/formato";
import { FormularioProveedor } from "../formulario";
import { CuentaDelProveedor } from "./cuenta";

export const metadata: Metadata = { title: "Proveedor" };

/**
 * La ficha del proveedor y su cuenta corriente.
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
  const proveedor = await obtenerProveedor(id);

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

      <CuentaDelProveedor
        supplierId={proveedor.id}
        movimientos={proveedor.movimientos}
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
            }}
          />
        </div>
      </details>
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
