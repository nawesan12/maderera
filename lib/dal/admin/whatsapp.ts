import "server-only";

import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accountMovements,
  avisosWhatsapp,
  branches,
  conversaciones,
  customers,
  mensajes,
  orders,
  profiles,
  sesionWhatsapp,
  user,
} from "@/lib/db/schema";
import { requireStaffRole, type SessionUser } from "@/lib/dal/session";
import { ACCESO, type RolStaff } from "@/lib/roles";
import { proveedorWhatsapp } from "@/lib/whatsapp";
import { plantillasDisponibles, type PlantillaDisponible } from "@/lib/whatsapp/catalogo";
import { documentosDelCliente, type DocumentoListado } from "@/lib/whatsapp/documentos";
import { sinNumero } from "@/lib/whatsapp/numeros";
import { datosDeSucursal } from "@/lib/whatsapp/avisos";
import { fechaCorta, moneda } from "@/lib/formato";
import { ventanaAbierta } from "@/lib/whatsapp/ventana";
import type { EstadoConexion } from "@/lib/whatsapp/tipos";

/**
 * Lectura de la bandeja de WhatsApp.
 *
 * Son conversaciones de todos los clientes juntas, con su saldo al costado:
 * **cada función exige el rol de la bandeja** (`ACCESO["/admin/whatsapp"]`) y
 * no solo ser personal. La página ya rebota a depósito y al aserradero, pero
 * una Server Action o una ruta que lea de acá no pasa por la página, y «una
 * página protegida no protege a su API».
 */

const ROLES_BANDEJA = ACCESO["/admin/whatsapp"] as readonly RolStaff[];

/** Exige poder usar la bandeja. Para las acciones y las rutas que la sirven. */
export function requireBandeja(): Promise<SessionUser> {
  return requireStaffRole(...ROLES_BANDEJA);
}

export type FiltroBandeja = "todas" | "sin-leer" | "mias" | "sin-asignar" | "resueltas";

export interface ConversacionListada {
  id: string;
  waJid: string;
  nombre: string;
  customerId: string | null;
  clienteNombre: string | null;
  clienteTipo: "particular" | "profesional" | null;
  estado: "abierta" | "cerrada";
  ultimoMensajeAt: Date | null;
  ultimoMensajePreview: string | null;
  ultimoEntranteAt: Date | null;
  noLeidos: number;
  /** Si todavía se puede contestar con mensaje libre. */
  ventanaAbierta: boolean;
  asignadoAUserId: string | null;
  asignadoNombre: string | null;
  baja: boolean;
}

export async function listarConversaciones(filtro: FiltroBandeja = "todas"): Promise<ConversacionListada[]> {
  const sesion = await requireBandeja();

  const condiciones: SQL[] = [];
  if (filtro === "resueltas") {
    condiciones.push(eq(conversaciones.estado, "cerrada"));
  } else {
    condiciones.push(eq(conversaciones.estado, "abierta"));
    if (filtro === "sin-leer") condiciones.push(sql`${conversaciones.noLeidos} > 0`);
    if (filtro === "mias") condiciones.push(eq(conversaciones.asignadoAUserId, sesion.userId));
    if (filtro === "sin-asignar") condiciones.push(isNull(conversaciones.asignadoAUserId));
  }

  const filas = await db
    .select({
      id: conversaciones.id,
      waJid: conversaciones.waJid,
      displayName: conversaciones.displayName,
      customerId: conversaciones.customerId,
      clienteNombre: customers.nombre,
      clienteTipo: customers.tipo,
      estado: conversaciones.estado,
      ultimoMensajeAt: conversaciones.ultimoMensajeAt,
      ultimoMensajePreview: conversaciones.ultimoMensajePreview,
      ultimoEntranteAt: conversaciones.ultimoEntranteAt,
      noLeidos: conversaciones.noLeidos,
      asignadoAUserId: conversaciones.asignadoAUserId,
      asignadoNombre: user.name,
      bajaAt: conversaciones.bajaAt,
    })
    .from(conversaciones)
    .leftJoin(customers, eq(customers.id, conversaciones.customerId))
    .leftJoin(user, eq(user.id, conversaciones.asignadoAUserId))
    .where(and(...condiciones))
    .orderBy(sql`${conversaciones.ultimoMensajeAt} desc nulls last`)
    .limit(150);

  return filas.map(({ bajaAt, ...f }) => ({
    ...f,
    nombre: f.clienteNombre ?? f.displayName ?? "Sin identificar",
    ventanaAbierta: ventanaAbierta(f.ultimoEntranteAt),
    baja: Boolean(bajaAt),
  }));
}

/** Los contadores de los filtros, para que se vea cuánto hay sin abrir cada uno. */
export async function contarBandeja() {
  const sesion = await requireBandeja();
  const { rows } = await db.execute<{ sin_leer: number; mias: number; sin_asignar: number }>(sql`
    select
      (count(*) filter (where no_leidos > 0))::int as sin_leer,
      (count(*) filter (where asignado_a_user_id = ${sesion.userId}))::int as mias,
      (count(*) filter (where asignado_a_user_id is null))::int as sin_asignar
    from whatsapp_conversaciones
    where estado = 'abierta'
  `);
  const fila = rows[0];
  return { sinLeer: fila?.sin_leer ?? 0, mias: fila?.mias ?? 0, sinAsignar: fila?.sin_asignar ?? 0 };
}

export interface MensajeDeLaBandeja {
  id: string;
  direccion: "entrante" | "saliente";
  tipo: string;
  waMessageId: string | null;
  cuerpo: string;
  /** La dirección autenticada del adjunto, nunca la del almacenamiento. */
  mediaUrl: string | null;
  mediaTipo: string | null;
  mediaMime: string | null;
  mediaNombre: string | null;
  mediaEstado: string | null;
  mediaBytes: number | null;
  datos: Record<string, unknown> | null;
  citado: { id: string; cuerpo: string; direccion: "entrante" | "saliente" } | null;
  reaccionCliente: string | null;
  reaccionNuestra: string | null;
  estado: "pendiente" | "enviado" | "entregado" | "leido" | "fallido";
  errorCodigo: number | null;
  errorDetalle: string | null;
  plantilla: string | null;
  origen: string | null;
  enviadoPor: string | null;
  cobroCategoria: string | null;
  cobrable: boolean | null;
  ocurridoAt: Date;
}

/**
 * Una conversación con sus mensajes y el contexto del cliente al costado.
 *
 * El saldo y los pedidos se traen acá porque son justo lo que hace falta para
 * contestar: «¿ya está listo lo mío?» y «¿cuánto debo?» son las dos preguntas
 * que llegan por WhatsApp.
 */
export async function obtenerConversacion(id: string) {
  await requireBandeja();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;

  const [conversacion] = await db
    .select({
      id: conversaciones.id,
      waJid: conversaciones.waJid,
      displayName: conversaciones.displayName,
      customerId: conversaciones.customerId,
      orderId: conversaciones.orderId,
      estado: conversaciones.estado,
      notas: conversaciones.notas,
      ultimoEntranteAt: conversaciones.ultimoEntranteAt,
      noLeidos: conversaciones.noLeidos,
      asignadoAUserId: conversaciones.asignadoAUserId,
      bajaAt: conversaciones.bajaAt,
      bajaDetalle: conversaciones.bajaDetalle,
      resueltaAt: conversaciones.resueltaAt,
      clienteNombre: customers.nombre,
      clienteTipo: customers.tipo,
      clienteTelefono: customers.telefono,
      clienteEmail: customers.email,
      clienteLimite: customers.limiteCredito,
      clienteEstado: customers.estado,
    })
    .from(conversaciones)
    .leftJoin(customers, eq(customers.id, conversaciones.customerId))
    .where(eq(conversaciones.id, id))
    .limit(1);

  if (!conversacion) return null;

  // Los últimos 300, en orden: una conversación de años no se carga entera.
  const recientes = await db
    .select({ mensaje: mensajes, enviadoPor: user.name })
    .from(mensajes)
    .leftJoin(user, eq(user.id, mensajes.enviadoPorUserId))
    .where(eq(mensajes.conversacionId, id))
    .orderBy(desc(mensajes.ocurridoAt))
    .limit(300);
  recientes.reverse();

  const porWaId = new Map(
    recientes.filter((r) => r.mensaje.waMessageId).map((r) => [r.mensaje.waMessageId!, r.mensaje]),
  );

  const listaMensajes: MensajeDeLaBandeja[] = recientes.map(({ mensaje: m, enviadoPor }) => {
    const citado = m.citadoWaMessageId ? porWaId.get(m.citadoWaMessageId) : undefined;
    return {
      id: m.id,
      direccion: m.direccion,
      tipo: m.tipo,
      waMessageId: m.waMessageId,
      cuerpo: m.cuerpo,
      mediaUrl: m.mediaUrl && m.mediaEstado !== "pendiente" && m.mediaEstado !== "fallido" ? `/api/whatsapp/medios/${m.id}` : null,
      mediaTipo: m.mediaTipo,
      mediaMime: m.mediaMime,
      mediaNombre: m.mediaNombre,
      // Un «pendiente» de hace más de cinco minutos es una descarga que se
      // cortó a mitad (se reinició el proceso): se muestra como fallida para
      // que aparezca el botón de reintentar.
      mediaEstado:
        m.mediaEstado === "pendiente" && Date.now() - m.createdAt.getTime() > 5 * 60_000
          ? "fallido"
          : (m.mediaEstado ?? (m.mediaUrl ? "listo" : null)),
      mediaBytes: m.mediaBytes,
      datos: m.datos ?? null,
      citado: citado
        ? { id: citado.id, cuerpo: citado.cuerpo || (citado.mediaTipo ? "Archivo" : ""), direccion: citado.direccion }
        : m.citadoWaMessageId
          ? { id: "", cuerpo: "Un mensaje anterior", direccion: "saliente" }
          : null,
      reaccionCliente: m.reaccionCliente,
      reaccionNuestra: m.reaccionNuestra,
      estado: m.estado,
      errorCodigo: m.errorCodigo,
      errorDetalle: m.errorDetalle,
      plantilla: m.plantilla,
      origen: m.origen,
      enviadoPor,
      cobroCategoria: m.cobroCategoria,
      cobrable: m.cobrable,
      ocurridoAt: m.ocurridoAt,
    };
  });

  let saldo = 0;
  let pedidos: {
    id: string;
    numero: string;
    estado: string;
    total: string;
    createdAt: Date;
    sucursal: string | null;
  }[] = [];
  let documentos: DocumentoListado[] = [];

  if (conversacion.customerId) {
    const [filaSaldo, filasPedidos, docs] = await Promise.all([
      db
        .select({ saldo: sql<string>`coalesce(sum(${accountMovements.monto}), 0)` })
        .from(accountMovements)
        .where(eq(accountMovements.customerId, conversacion.customerId)),
      db
        .select({
          id: orders.id,
          numero: orders.numero,
          estado: orders.estado,
          total: orders.total,
          createdAt: orders.createdAt,
          sucursal: branches.name,
        })
        .from(orders)
        .leftJoin(branches, eq(branches.id, orders.branchId))
        .where(eq(orders.customerId, conversacion.customerId))
        .orderBy(desc(orders.createdAt))
        .limit(5),
      documentosDelCliente(conversacion.customerId),
    ]);

    saldo = Number(filaSaldo[0]?.saldo ?? 0);
    pedidos = filasPedidos;
    documentos = docs;
  }

  // Lo que ya se sabe, para precargar los datos de un mensaje preparado.
  const pedido = pedidos[0];
  const conocidos: Record<string, string> = {
    ...(pedido ? { pedido: pedido.numero, ...datosDeSucursal(pedido.sucursal, null) } : {}),
    ...(saldo > 0 ? { saldo: moneda.format(saldo) } : {}),
    fecha: fechaCorta.format(new Date()),
  };

  return {
    ...conversacion,
    conocidos,
    nombre: conversacion.clienteNombre ?? conversacion.displayName ?? "Sin identificar",
    sinNumero: sinNumero(conversacion.waJid),
    ventanaAbierta: ventanaAbierta(conversacion.ultimoEntranteAt),
    mensajes: listaMensajes,
    saldo,
    limiteCredito: Number(conversacion.clienteLimite ?? 0),
    pedidos,
    documentos,
  };
}

export type DetalleConversacion = NonNullable<Awaited<ReturnType<typeof obtenerConversacion>>>;

/**
 * Pone en cero los no leídos y devuelve el último entrante, para avisarle a
 * WhatsApp que se leyó (los dos tildes azules del lado del cliente).
 *
 * No revalida nada a propósito: la llama la propia pantalla que la muestra, y
 * revalidar desde ahí la haría volver a renderizarse en un ciclo.
 */
export async function marcarLeidaSilencioso(id: string): Promise<string | null> {
  await db
    .update(conversaciones)
    .set({ noLeidos: 0 })
    .where(and(eq(conversaciones.id, id), sql`${conversaciones.noLeidos} > 0`));

  const [ultimo] = await db
    .select({ waMessageId: mensajes.waMessageId })
    .from(mensajes)
    .where(and(eq(mensajes.conversacionId, id), eq(mensajes.direccion, "entrante"), isNotNull(mensajes.waMessageId)))
    .orderBy(desc(mensajes.ocurridoAt))
    .limit(1);
  return ultimo?.waMessageId ?? null;
}

/** Cuántas conversaciones tienen mensajes sin leer. Va en el menú del panel. */
export async function conversacionesSinLeer(): Promise<number> {
  const [fila] = await db
    .select({ total: sql<number>`count(*)` })
    .from(conversaciones)
    .where(and(eq(conversaciones.estado, "abierta"), sql`${conversaciones.noLeidos} > 0`));

  return Number(fila?.total ?? 0);
}

/** Estado de la conexión, mezclando lo que dice el proveedor y lo guardado. */
export async function estadoWhatsapp(): Promise<EstadoConexion & { ultimoWebhookAt: number | null }> {
  await requireBandeja();

  const estado = await proveedorWhatsapp().estado();
  const [fila] = await db
    .select({ ultimaSenal: sesionWhatsapp.ultimaSenal, ultimoWebhookAt: sesionWhatsapp.ultimoWebhookAt })
    .from(sesionWhatsapp)
    .limit(1);

  return {
    ...estado,
    ultimaSenal: fila?.ultimaSenal ? fila.ultimaSenal.getTime() : estado.ultimaSenal,
    ultimoWebhookAt: fila?.ultimoWebhookAt ? fila.ultimoWebhookAt.getTime() : null,
  };
}

/** Las plantillas que se pueden mandar ahora. */
export async function listarPlantillas(): Promise<PlantillaDisponible[]> {
  await requireBandeja();
  return plantillasDisponibles();
}

/** Configuración de los avisos automáticos. */
export async function listarAvisos() {
  await requireStaffRole("admin");
  return db.select().from(avisosWhatsapp).orderBy(asc(avisosWhatsapp.evento));
}

/** Quiénes pueden atender: para el «asignar a». */
export async function personalDeLaBandeja() {
  await requireBandeja();
  return db
    .select({ id: user.id, nombre: user.name })
    .from(user)
    .innerJoin(profiles, eq(profiles.userId, user.id))
    .where(and(eq(profiles.role, "staff"), inArray(profiles.staffRole, [...ROLES_BANDEJA])))
    .orderBy(asc(user.name));
}

/**
 * Lo que Meta dice que cobró este mes, contado de los estados.
 *
 * No reemplaza la factura de Meta, pero contesta «¿cuánto nos está costando?»
 * sin esperarla. Los de servicio se cuentan aparte porque los primeros del mes
 * no se cobran: Meta los informa como `free_customer_service`.
 */
export async function gastoDelMes() {
  await requireStaffRole("admin");
  const inicio = new Date();
  inicio.setDate(1);
  inicio.setHours(0, 0, 0, 0);

  const filas = await db
    .select({
      categoria: mensajes.cobroCategoria,
      cobrable: mensajes.cobrable,
      total: sql<number>`count(*)::int`,
    })
    .from(mensajes)
    .where(and(eq(mensajes.direccion, "saliente"), gte(mensajes.createdAt, inicio), isNotNull(mensajes.cobroCategoria)))
    .groupBy(mensajes.cobroCategoria, mensajes.cobrable);

  return filas.map((f) => ({ categoria: f.categoria ?? "?", cobrable: Boolean(f.cobrable), total: Number(f.total) }));
}

/** Los números que pidieron no recibir avisos. */
export async function bajasRegistradas() {
  await requireStaffRole("admin");
  return db
    .select({
      id: conversaciones.id,
      waJid: conversaciones.waJid,
      nombre: sql<string>`coalesce(${customers.nombre}, ${conversaciones.displayName}, 'Sin identificar')`,
      bajaAt: conversaciones.bajaAt,
      bajaDetalle: conversaciones.bajaDetalle,
    })
    .from(conversaciones)
    .leftJoin(customers, eq(customers.id, conversaciones.customerId))
    .where(isNotNull(conversaciones.bajaAt))
    .orderBy(desc(conversaciones.bajaAt));
}

/** El último chequeo guardado, para no repetirlo en cada visita. */
export async function ultimoDiagnostico() {
  await requireStaffRole("admin");
  const [fila] = await db
    .select({
      diagnostico: sesionWhatsapp.diagnostico,
      diagnosticoAt: sesionWhatsapp.diagnosticoAt,
      calidad: sesionWhatsapp.calidad,
      limite: sesionWhatsapp.limiteMensajes,
      ultimoWebhookAt: sesionWhatsapp.ultimoWebhookAt,
    })
    .from(sesionWhatsapp)
    .limit(1);
  return fila ?? null;
}
