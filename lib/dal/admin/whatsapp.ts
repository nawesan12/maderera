import "server-only";

import { api, datos } from "@/lib/api/servidor";
// Los esquemas de este dominio, no los de todos juntos: «Mensaje» también existe en otro.
import type { components } from "@/lib/api/tipos/whatsapp";

type Esquemas = components["schemas"];
import { requireStaffRole, type SessionUser } from "@/lib/dal/session";
import { ACCESO, type RolStaff } from "@/lib/roles";
import type { PlantillaLeida } from "@/lib/whatsapp/plantillas";

/**
 * La bandeja de WhatsApp. La sirve la API de Go (backend/internal/whatsapp):
 * la lista, la conversación con el cliente al costado, las plantillas, el
 * gasto y la configuración. Go exige el rol de la bandeja en cada ruta; acá
 * solo se pasan las fechas a `Date`.
 */

const ROLES_BANDEJA = ACCESO["/admin/whatsapp"] as readonly RolStaff[];

/** Exige poder usar la bandeja. Para las páginas que la muestran. */
export function requireBandeja(): Promise<SessionUser> {
  return requireStaffRole(...ROLES_BANDEJA);
}

export type FiltroBandeja = "todas" | "sin-leer" | "mias" | "sin-asignar" | "resueltas";

type Fechas<T, K extends keyof T> = Omit<T, K> & { [P in K]: null extends T[P] ? Date | null : Date };

const fecha = (v: string | null | undefined) => (v ? new Date(v) : null);

export type ConversacionListada = Fechas<Esquemas["ConversacionListada"], "ultimoMensajeAt" | "ultimoEntranteAt"> & {
  clienteTipo: "particular" | "profesional" | null;
};

export type MensajeDeLaBandeja = Fechas<Esquemas["Mensaje"], "ocurridoAt"> & {
  datos: Record<string, unknown> | null;
};

/** Una plantilla aprobada, leída como la lee el compositor (lib/whatsapp/plantillas.ts). */
export type PlantillaDisponible = PlantillaLeida & { uso: string | null };
export type DocumentoListado = Fechas<Esquemas["DocumentoListado"], "fecha">;
export type EstadoConexion = Esquemas["EstadoConexion"];

export type DetalleConversacion = Fechas<
  Omit<Esquemas["DetalleConversacion"], "mensajes" | "pedidos" | "documentos">,
  "ultimoEntranteAt" | "bajaAt" | "resueltaAt"
> & {
  clienteTipo: "particular" | "profesional" | null;
  mensajes: MensajeDeLaBandeja[];
  pedidos: (Omit<Esquemas["DetalleConversacion"]["pedidos"][number], "createdAt"> & { createdAt: Date })[];
  documentos: DocumentoListado[];
};

function conversacion(c: Esquemas["ConversacionListada"]): ConversacionListada {
  return {
    ...c,
    clienteTipo: c.clienteTipo as ConversacionListada["clienteTipo"],
    ultimoMensajeAt: fecha(c.ultimoMensajeAt),
    ultimoEntranteAt: fecha(c.ultimoEntranteAt),
  };
}

function detalle(d: Esquemas["DetalleConversacion"]): DetalleConversacion {
  return {
    ...d,
    clienteTipo: d.clienteTipo as DetalleConversacion["clienteTipo"],
    ultimoEntranteAt: fecha(d.ultimoEntranteAt),
    bajaAt: fecha(d.bajaAt),
    resueltaAt: fecha(d.resueltaAt),
    mensajes: d.mensajes.map((m) => ({ ...m, datos: (m.datos ?? null) as Record<string, unknown> | null, ocurridoAt: new Date(m.ocurridoAt) })),
    pedidos: d.pedidos.map((p) => ({ ...p, createdAt: new Date(p.createdAt) })),
    documentos: d.documentos.map((x) => ({ ...x, fecha: fecha(x.fecha) })),
  };
}

/**
 * Todo lo que muestra la bandeja, en un pedido: la lista del filtro, los
 * contadores, la conexión, las plantillas, el personal, el gasto y la
 * conversación elegida (o la primera). Abrirla es haberla leído: Go pone los
 * no leídos en cero y le avisa a WhatsApp, después de contestar.
 */
export async function abrirBandeja(filtro?: string, chat?: string) {
  const b = datos(
    await (await api()).GET("/api/v1/admin/whatsapp/bandeja", {
      params: { query: { ...(filtro ? { filtro: filtro.slice(0, 40) } : {}), ...(chat ? { chat: chat.slice(0, 64) } : {}) } },
    }),
  );
  return {
    ...b,
    filtro: b.filtro as FiltroBandeja,
    plantillas: b.plantillas as PlantillaDisponible[],
    conversaciones: b.conversaciones.map(conversacion),
    detalle: b.detalle ? detalle(b.detalle) : null,
  };
}

/** Una conversación, o null si no existe. */
export async function obtenerConversacion(id: string): Promise<DetalleConversacion | null> {
  const r = await (await api()).GET("/api/v1/admin/whatsapp/conversaciones/{id}", { params: { path: { id } } });
  if (r.response.status === 404) return null;
  return detalle(datos(r));
}

/** Cuántas conversaciones tienen mensajes sin leer. Va en el menú del panel. */
export async function conversacionesSinLeer(): Promise<number> {
  const r = await (await api()).GET("/api/v1/admin/whatsapp/sin-leer");
  // El menú no puede tirar el panel entero si la API no contesta.
  return r.data?.total ?? 0;
}

/** Todo lo de /admin/whatsapp/configuracion (solo admin). */
export async function configuracionWhatsapp() {
  const c = datos(await (await api()).GET("/api/v1/admin/whatsapp/configuracion"));
  return {
    ...c,
    guardadas: c.guardadas.map((g) => ({ ...g, sincronizadaAt: new Date(g.sincronizadaAt) })),
    diagnostico: c.diagnostico
      ? {
          ...c.diagnostico,
          diagnosticoAt: fecha(c.diagnostico.diagnosticoAt),
          ultimoWebhookAt: fecha(c.diagnostico.ultimoWebhookAt),
        }
      : null,
    gasto: { ...c.gasto, reinicio: new Date(c.gasto.reinicio) },
    bajas: c.bajas.map((b) => ({ ...b, bajaAt: fecha(b.bajaAt) })),
    cortados: c.cortados.map((x) => ({ ...x, fecha: new Date(x.fecha) })),
  };
}
