import { Bell } from "lucide-react";
import { actividadReciente } from "@/lib/dal/admin/auditoria";
import { rutaDeEntidad } from "@/lib/dal/admin/rutas-entidad";
import { trabajoPendiente } from "@/lib/dal/admin/pendientes";
import { PanelDeActividad } from "./panel-actividad";
import { PanelDePendientes } from "./panel-pendientes";

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
        // La ruta se resuelve acá, en el servidor: el panel es un componente
        // de cliente y no tiene por qué conocer el mapa de rutas del sistema.
        href: rutaDeEntidad(e.entidad, e.entidadId),
      }))}
    />
  );
}

/**
 * La campana de quien no entra a la bitácora: lo urgente de su rol, lo
 * mismo que «Para hoy» (mes simulado, M2S1-191). El PIN se carga desde el
 * inicio y no va acá. Si la API falla, la campana queda vacía: está en todas
 * las pantallas y no puede tirar abajo el panel.
 */
export async function CampanaDePendientes() {
  const pendientes = await trabajoPendiente().catch(() => []);
  return (
    <PanelDePendientes
      pendientes={pendientes
        .filter((p) => p.urgente && p.clave !== "pin")
        .map((p) => ({ clave: p.clave, cantidad: p.cantidad, texto: p.texto, href: p.href, vencido: p.vencido }))}
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
