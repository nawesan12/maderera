import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ClipboardList } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { Vacio } from "@/components/admin/vacio";
import { requireStaff } from "@/lib/dal/session";
import { listarGestiones } from "@/lib/dal/admin/seguimiento";
import { TableroDeSeguimiento } from "./vista";
import { obtenerCliente } from "@/lib/dal/admin/clientes";
import { esUuid } from "@/lib/uuid";
import { moneda, plural } from "@/lib/formato";

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
export default async function SeguimientoPage({
  searchParams,
}: {
  /* `cliente`: se llega desde lo que debe (la ficha o «Por cobrar») y el
     seguimiento nuevo arranca con el cliente y la deuda puestos. */
  searchParams: Promise<{ cliente?: string }>;
}) {
  await requireStaff();
  const { cliente: clienteId } = await searchParams;
  const deudor = clienteId && esUuid(clienteId) ? await obtenerCliente(clienteId) : null;

  // El cliente de una gestión nueva se busca escribiendo
  // (components/admin/elegir-cliente.tsx): antes esta pantalla se bajaba la
  // cartera entera para filtrarla en el navegador.
  const gestiones = await listarGestiones({ incluirCerradas: true });

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
        resumen={
          vencidas > 0
            ? `${plural(abiertas.length, "gestión abierta", "gestiones abiertas")} · ${vencidas} para hoy o ${vencidas === 1 ? "vencida" : "vencidas"}`
            : plural(abiertas.length, "gestión abierta", "gestiones abiertas")
        }
      />

      {gestiones.length === 0 ? (
        <section className="tarjeta overflow-hidden">
          <Vacio
            icono={ClipboardList}
            titulo="Todavía no hay ningún seguimiento"
            // Se abren desde la ficha de un cliente o con el botón de abajo. Lo que
            // tenga fecha vencida aparece en el Para hoy del panel.
          />
        </section>
      ) : null}

      <TableroDeSeguimiento
        gestiones={gestiones}
        nueva={
          deudor
            ? {
                cliente: { id: deudor.id, nombre: deudor.nombre, razonSocial: deudor.razonSocial, cuit: deudor.cuit },
                asunto: deudor.saldo > 0 ? `Cobrar ${moneda.format(deudor.saldo)}` : "",
              }
            : undefined
        }
      />
    </div>
  );
}
