import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { listarSucursalesPublicas } from "@/lib/dal/envios";
import { obtenerCliente } from "@/lib/dal/admin/clientes";
import { obtenerPresupuesto } from "@/lib/dal/admin/ventas";
import { tarifasDeCorte } from "@/lib/dal/cortes-tarifas";
import { requireStaff } from "@/lib/dal/session";
import { esUuid } from "@/lib/uuid";
import { FormularioPresupuesto, type PresupuestoInicial } from "./formulario";

export const metadata = { title: "Nuevo presupuesto" };

/**
 * Carga de un presupuesto a mano.
 *
 * Existe porque la mitad del trabajo de una maderera entra por teléfono, y
 * hasta acá un presupuesto solo podía nacer del sitio: quien atendía lo
 * anotaba en un papel.
 *
 * Con `editar` corrige uno que todavía no se mandó (mismo número); con
 * `desde` arranca con los renglones de otro (mes simulado: un error obligaba
 * a rechazarlo y cargar todo de nuevo, también después de cancelar el pedido).
 */
export default async function NuevoPresupuestoPage({
  searchParams,
}: {
  /* `cliente` llega desde la lista o la ficha de clientes: el presupuesto
     telefónico casi siempre empieza por saber a quién es. */
  searchParams: Promise<{ cliente?: string; editar?: string; desde?: string }>;
}) {
  const usuario = await requireStaff();
  const { cliente: clienteId, editar, desde } = await searchParams;
  const origenId = editar ?? desde;
  if (origenId && !esUuid(origenId)) notFound();

  const [sucursales, origen, tarifas] = await Promise.all([
    listarSucursalesPublicas(),
    origenId ? obtenerPresupuesto(origenId) : Promise.resolve(null),
    // Sin permiso o sin tarifas, el corte va como renglón a mano.
    tarifasDeCorte().catch(() => []),
  ]);
  if (origenId && !origen) notFound();
  const idDelCliente = origen?.customerId ?? (clienteId && esUuid(clienteId) ? clienteId : null);
  const cliente = idDelCliente ? await obtenerCliente(idDelCliente) : null;

  const inicial: PresupuestoInicial | undefined = origen
    ? {
        lineas: origen.items.map((i) => ({
          variantId: i.variantId,
          descripcion: i.descripcion,
          unidad: i.unidad,
          cantidad: Number(i.cantidad),
          precioUnitario: Number(i.precioUnitario),
          // Con el piso, corregir o duplicar marca «Bajo costo» y pide
          // «Guardar igual» como el alta (mes simulado: se salteaba).
          piso: i.piso ?? null,
        })),
        contactoNombre: origen.cliente,
        contactoTelefono: origen.telefono,
        contactoEmail: origen.email,
        branchId: sucursales.find((s) => s.slug === origen.sucursalSlug)?.id ?? null,
        notas: origen.notas,
      }
    : undefined;

  const titulo = editar && origen ? `Corregir ${origen.numero}` : "Nuevo presupuesto";

  return (
    <div className="space-y-6">
      <Link
        href={editar ? `/admin/presupuestos/${editar}` : "/admin/presupuestos"}
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
        {editar ? "Volver al presupuesto" : "Volver a presupuestos"}
      </Link>

      <h1 className="text-3xl font-bold text-foreground">{titulo}</h1>

      <FormularioPresupuesto
        sucursales={sucursales.map((s) => ({ id: s.id, nombre: s.nombre }))}
        asesor={usuario.name}
        inicial={inicial}
        editar={editar}
        origen={origenId}
        tarifas={tarifas}
        clienteInicial={
          cliente
            ? {
                id: cliente.id,
                nombre: cliente.nombre,
                razonSocial: cliente.razonSocial,
                telefono: cliente.telefono,
                email: cliente.email,
                priceListId: cliente.priceListId,
              }
            : undefined
        }
      />
    </div>
  );
}
