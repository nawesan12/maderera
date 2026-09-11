import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { listarSucursalesPublicas } from "@/lib/dal/envios";
import { obtenerCliente } from "@/lib/dal/admin/clientes";
import { requireStaff } from "@/lib/dal/session";
import { FormularioPresupuesto } from "./formulario";

export const metadata = { title: "Nuevo presupuesto" };

/**
 * Carga de un presupuesto a mano.
 *
 * Existe porque la mitad del trabajo de una maderera entra por teléfono, y
 * hasta acá un presupuesto solo podía nacer del sitio: quien atendía lo
 * anotaba en un papel.
 */
export default async function NuevoPresupuestoPage({
  searchParams,
}: {
  /* `cliente` llega desde la lista o la ficha de clientes: el presupuesto
     telefónico casi siempre empieza por saber a quién es. */
  searchParams: Promise<{ cliente?: string }>;
}) {
  const usuario = await requireStaff();
  const { cliente: clienteId } = await searchParams;

  const [sucursales, cliente] = await Promise.all([
    listarSucursalesPublicas(),
    clienteId ? obtenerCliente(clienteId) : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      <Link
        href="/admin/presupuestos"
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
        Volver a presupuestos
      </Link>

      <div>
        <h1 className="text-3xl font-bold text-foreground">Nuevo presupuesto</h1>
        <p className="mt-1 text-base text-muted-foreground">
          Para lo que entra por teléfono o por el mostrador. Queda en la misma
          cola que los del sitio y se convierte en pedido con un botón.
        </p>
      </div>

      <FormularioPresupuesto
        sucursales={sucursales.map((s) => ({ id: s.id, nombre: s.nombre }))}
        asesor={usuario.name}
        clienteInicial={
          cliente
            ? {
                id: cliente.id,
                nombre: cliente.nombre,
                razonSocial: cliente.razonSocial,
              }
            : undefined
        }
      />
    </div>
  );
}
