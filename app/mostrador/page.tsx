import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/dal/session";
import { inicioDelRol } from "@/lib/roles";
import { listarSucursalesPublicas } from "@/lib/dal/envios";
import { movimientosDelTurno, turnoAbierto } from "@/lib/mostrador/caja";
import { VistaMostrador } from "./vista";

export const metadata: Metadata = {
  title: "Mostrador",
  robots: { index: false, follow: false },
};

/**
 * El punto de venta del mostrador.
 *
 * Pantalla completa y fuera de `/admin`, por lo mismo que el taller y la
 * atención por WhatsApp: quien está acá tiene a alguien esperando enfrente y
 * necesita el alto entero de la pantalla para la venta, no un menú lateral que
 * no va a tocar en todo el día.
 *
 * La sucursal viene por la dirección (`?sucursal=`) y no de una preferencia
 * guardada: la misma computadora puede estar en el mostrador de Casa Central
 * hoy y en el del aserradero mañana, y una preferencia pegada al usuario es
 * cómo se termina descontando stock de la sucursal equivocada.
 */
export default async function MostradorPage({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const usuario = await requireStaff();

  /*
   * El mostrador es de quien atiende. Depósito y aserradero tienen su propia
   * pantalla y no cobran: dejarlos entrar acá sería darles una caja registradora
   * que no les toca. Se los manda a donde sí trabajan.
   */
  if (usuario.staffRole && !["admin", "vendedor"].includes(usuario.staffRole)) {
    redirect(inicioDelRol(usuario.staffRole));
  }

  const { sucursal } = await searchParams;

  const sucursales = await listarSucursalesPublicas();
  if (sucursales.length === 0) redirect("/admin/sucursales");

  const elegida =
    sucursales.find((s) => s.slug === sucursal) ?? sucursales[0];

  const turno = await turnoAbierto(elegida.id);
  const movimientos = turno ? await movimientosDelTurno(turno.id) : [];

  return (
    <VistaMostrador
      usuario={{ nombre: usuario.name }}
      sucursales={sucursales.map((s) => ({
        id: s.id,
        slug: s.slug,
        nombre: s.nombre,
      }))}
      sucursal={{ id: elegida.id, slug: elegida.slug, nombre: elegida.nombre }}
      turno={turno}
      movimientos={movimientos.map((m) => ({
        ...m,
        monto: Number(m.monto),
        createdAt: m.createdAt.toISOString(),
      }))}
    />
  );
}
