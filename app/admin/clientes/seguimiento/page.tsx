import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ClipboardList } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { Vacio } from "@/components/admin/vacio";
import { requireStaff } from "@/lib/dal/session";
import { listarGestiones } from "@/lib/dal/admin/seguimiento";
import { listarClientes } from "@/lib/dal/admin/clientes";
import { TableroDeSeguimiento } from "./vista";

export const metadata: Metadata = { title: "Seguimiento" };

/**
 * El tablero de gestiones con clientes.
 *
 * **Por qué existe.** De la clienta: «seguimiento tipo pipeline para que los
 * recordatorios estén asentados». Lo que había era el campo de notas de la
 * ficha —un texto que se pisa— y la memoria de quien atendió: a quién había que
 * volver a llamar, qué prometió y para cuándo.
 *
 * Las cuatro columnas son las de una gestión real, no las de un embudo de
 * ventas: acá el cliente ya existe. Lo que se sigue es la cobranza que quedó a
 * medias o el presupuesto que espera respuesta.
 *
 * Lo vencido va arriba y en rojo, y además entra al «Para hoy» del panel: un
 * recordatorio que hay que venir a buscar no es un recordatorio.
 */
export default async function SeguimientoPage() {
  await requireStaff();

  const [gestiones, clientes] = await Promise.all([
    listarGestiones({ incluirCerradas: true }),
    listarClientes({}),
  ]);

  const abiertas = gestiones.filter((g) => g.etapa !== "cerrado");
  const vencidas = abiertas.filter((g) => g.vencida).length;

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
        titulo="Seguimiento"
        detalle={
          vencidas > 0
            ? `${abiertas.length} gestiones abiertas · ${vencidas} para hoy o vencidas`
            : `${abiertas.length} gestiones abiertas`
        }
      />

      {gestiones.length === 0 ? (
        <section className="tarjeta overflow-hidden">
          <Vacio
            icono={ClipboardList}
            titulo="Todavía no hay ningún seguimiento"
            detalle="Se abren desde la ficha de un cliente o con el botón de acá abajo: «llamar el martes por la factura 1234». Lo que tenga fecha vencida aparece en el Para hoy del panel."
          />
        </section>
      ) : null}

      <TableroDeSeguimiento
        gestiones={gestiones}
        clientes={clientes.map((c) => ({
          id: c.id,
          nombre: c.razonSocial ?? c.nombre,
        }))}
      />
    </div>
  );
}
