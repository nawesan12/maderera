import { Bell } from "lucide-react";
import { actividadReciente } from "@/lib/dal/admin/auditoria";
import { PanelDeActividad } from "./panel-actividad";

/**
 * La campana de actividad, contra la bitácora.
 *
 * Mostraba cinco avisos escritos a mano en `lib/dashboard-data.ts` —los mismos
 * cinco, siempre, con "hace 5 min" congelado—. Ahora lee `audit_log`, así que
 * dice quién hizo qué en el panel y cuándo. En un mostrador con tres personas
 * cargando al mismo tiempo, es la respuesta a "¿esto ya lo tomó alguien?".
 *
 * Es Server Component: la lista se arma en el servidor y el único trozo de
 * cliente es el panel que se abre.
 */
export async function ActivityBell() {
  const eventos = await actividadReciente(15);

  return (
    <PanelDeActividad
      eventos={eventos.map((e) => ({
        id: e.id,
        usuario: e.usuarioNombre,
        accion: e.accion,
        entidad: e.entidad,
        descripcion: e.descripcion,
        fecha: e.createdAt,
      }))}
    />
  );
}

/** Placeholder mientras carga, para que el encabezado no salte. */
export function ActivityBellSkeleton() {
  return (
    <span className="text-muted-foreground" aria-hidden="true">
      <Bell className="h-5 w-5" />
    </span>
  );
}
