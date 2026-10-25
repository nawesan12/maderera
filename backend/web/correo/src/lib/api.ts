import type { DatosSesion } from "./sesion.svelte";
import type { Ficha } from "./clientes.svelte";

// La API del webmail (backend/internal/correo/http.go). Los tipos son los
// mismos nombres que el JSON de Go.

export type Rol = "entrada" | "enviados" | "borradores" | "papelera" | "spam" | "archivo" | "";

export interface Carpeta {
  ruta: string;
  nombre: string;
  rol?: Rol;
  total: number;
  noLeidos: number;
}

export interface Direccion {
  nombre?: string;
  correo: string;
}

export interface Resumen {
  uid: number;
  de: Direccion[];
  para: Direccion[];
  asunto: string;
  fecha: string;
  leido: boolean;
  destacado: boolean;
  respondido: boolean;
  adjuntos: boolean;
  tamano: number;
  /** La primera línea de lo que escribió la persona. */
  vista: string;
  etiquetas: string[];
  /** El Message-ID del primer mensaje de la conversación. */
  hilo?: string;
}

/** Lo que achica la lista: la pestaña y los botones de la búsqueda. */
export interface Filtro {
  q?: string;
  filtro?: "" | "sin-leer" | "sin-responder" | "destacados";
  adjuntos?: boolean;
  dias?: number;
  de?: string;
}

export interface Pagina {
  mensajes: Resumen[];
  total: number;
  pagina: number;
  paginas: number;
}

export interface Adjunto {
  indice: number;
  nombre: string;
  tipo: string;
  tamano: number;
  enLinea: boolean;
  /** Un programa (.exe, .scr…): no se deja bajar. */
  bloqueado?: boolean;
}

/** Por qué un correo parece una estafa (backend/internal/correo/sospecha.go). */
export interface Sospecha {
  motivo: string;
  enlaces?: { texto: string; destino: string }[];
}

export interface Mensaje extends Omit<Resumen, "adjuntos" | "vista"> {
  cc: Direccion[];
  responderA: Direccion[];
  messageId?: string;
  referencias?: string[];
  texto: string;
  tieneHtml: boolean;
  imagenesRemotas: boolean;
  adjuntos: Adjunto[];
  sospecha?: Sospecha;
}

export type Accion =
  | "leido"
  | "no-leido"
  | "destacar"
  | "no-destacar"
  | "archivar"
  | "papelera"
  | "spam"
  | "mover"
  | "restaurar"
  | "etiquetar"
  | "desetiquetar";

/** Un error de la API, con los mensajes por campo si los hay. */
export class ErrorApi extends Error {
  constructor(
    public estado: number,
    mensaje: string,
    public errores: Record<string, string> = {},
  ) {
    super(mensaje);
  }
}

/** Se dispara cuando la sesión venció: la App vuelve a la pantalla de entrar. */
export const sesionCerrada = new EventTarget();

async function pedir<T>(metodo: string, ruta: string, cuerpo?: BodyInit | object): Promise<T> {
  const init: RequestInit = { method: metodo, credentials: "same-origin", headers: {} };
  if (cuerpo instanceof FormData) {
    init.body = cuerpo;
  } else if (cuerpo !== undefined) {
    init.body = JSON.stringify(cuerpo);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  let r: Response;
  try {
    r = await fetch(ruta, init);
  } catch {
    throw new ErrorApi(0, "Sin conexión. Revisá internet y probá de nuevo.");
  }
  if (r.status === 204) return undefined as T;
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && ruta !== "/api/sesion") sesionCerrada.dispatchEvent(new Event("cerrada"));
    throw new ErrorApi(r.status, datos.detail ?? datos.title ?? "Algo falló.", datos.errores);
  }
  return datos as T;
}

const c = (ruta: string) => encodeURIComponent(ruta);

export interface Persona {
  id: string;
  nombre: string;
  correo: string;
  rol: string;
}

export interface EstadoHilo {
  hilo: string;
  estado: "nuevo" | "en-curso" | "esperando" | "resuelto";
  asignadoA: string;
  asignadoNombre: string;
  notas: number;
}

export interface Nota {
  id: string;
  autor: string;
  texto: string;
  createdAt: string;
}

export interface Seguimiento {
  id: string;
  hilo: string;
  para: string;
  asunto: string;
  enviado: string;
  vence: string;
  vencido: boolean;
}

export interface Plantilla {
  id: string;
  titulo: string;
  atajo: string;
  texto: string;
}

export interface TiempoRespuesta {
  persona: string;
  conversaciones: number;
  medianaSegundos: number;
}

/** Lo que se manda para identificar una conversación al guardarla. */
export interface DatosHilo {
  hilo: string;
  asunto?: string;
  remitente?: string;
  recibido?: string;
}

export const api = {
  sesion: () => pedir<DatosSesion>("GET", "/api/sesion"),
  entrar: (correo: string, clave: string) => pedir<DatosSesion>("POST", "/api/sesion", { correo, clave }),
  /** De estos correos, cuáles son de clientes del ERP. */
  remitentes: (correos: string[]) =>
    pedir<string[]>("GET", "/api/remitentes?" + new URLSearchParams(correos.map((x) => ["correo", x]))),
  /** Clientes del ERP que coinciden con lo escrito, para sugerir en «Para». */
  contactos: (q: string) => pedir<Direccion[]>("GET", "/api/contactos?" + new URLSearchParams({ q })),
  cliente: async (correo: string) => {
    try {
      return await pedir<Ficha>("GET", "/api/cliente?" + new URLSearchParams({ correo }));
    } catch (e) {
      if (e instanceof ErrorApi && e.estado === 404) return null;
      throw e;
    }
  },
  presupuesto: (texto: string, correo: string) =>
    pedir<{ renglones: { texto: string; cantidad: number; buscado: string; producto?: { id: string; nombre: string; unidad: string; precio?: string; enlace: string }; alternativas: { id: string; nombre: string; unidad: string; precio?: string; enlace: string }[] }[]; lista?: string; abrir: string }>(
      "POST",
      "/api/presupuesto",
      { texto, correo },
    ),
  equipo: () => pedir<{ personas: Persona[]; dueno?: string }>("GET", "/api/equipo"),
  hilos: (hilos: string[]) =>
    pedir<Record<string, EstadoHilo>>("GET", "/api/hilos?" + new URLSearchParams(hilos.map((h) => ["h", h]))),
  guardarHilo: (d: DatosHilo & { estado?: string; asignadoA?: string; soltar?: boolean }) =>
    pedir<EstadoHilo>("PUT", "/api/hilos", d),
  notas: (hilo: string) => pedir<Nota[]>("GET", "/api/hilos/notas?" + new URLSearchParams({ h: hilo })),
  crearNota: (d: DatosHilo & { autorId: string; texto: string }) => pedir<Nota>("POST", "/api/hilos/notas", d),
  borrarNota: (id: string) => pedir<void>("DELETE", `/api/hilos/notas/${encodeURIComponent(id)}`),
  tiempos: (dias = 30) => pedir<TiempoRespuesta[]>("GET", `/api/tiempos?dias=${dias}`),
  seguimientos: () => pedir<Seguimiento[]>("GET", "/api/seguimientos"),
  cancelarSeguimiento: (id: string) => pedir<void>("DELETE", `/api/seguimientos/${encodeURIComponent(id)}`),
  plantillas: () => pedir<Plantilla[]>("GET", "/api/plantillas"),
  guardarPlantilla: (p: Omit<Plantilla, "id">) => pedir<{ id: string }>("PUT", "/api/plantillas", p),
  borrarPlantilla: (id: string) => pedir<void>("DELETE", `/api/plantillas/${encodeURIComponent(id)}`),
  urlZip: (carpeta: string, uid: number, indices: number[]) =>
    `/api/carpetas/${c(carpeta)}/mensajes/${uid}/adjuntos.zip?` + new URLSearchParams({ i: indices.join(",") }),
  salir: () => pedir<void>("DELETE", "/api/sesion"),
  carpetas: () => pedir<Carpeta[]>("GET", "/api/carpetas"),
  lista: (carpeta: string, pagina = 1, f: Filtro = {}) => {
    const p = new URLSearchParams({ pagina: String(pagina) });
    if (f.q) p.set("q", f.q);
    if (f.filtro) p.set("filtro", f.filtro);
    if (f.adjuntos) p.set("adjuntos", "si");
    if (f.dias) p.set("dias", String(f.dias));
    if (f.de) p.set("de", f.de);
    return pedir<Pagina>("GET", `/api/carpetas/${c(carpeta)}/mensajes?${p}`);
  },
  mensaje: (carpeta: string, uid: number) => pedir<Mensaje>("GET", `/api/carpetas/${c(carpeta)}/mensajes/${uid}`),
  acciones: (carpeta: string, uids: number[], accion: Accion, destino?: string) =>
    pedir<void>("POST", `/api/carpetas/${c(carpeta)}/acciones`, { uids, accion, destino }),
  enviar: (datos: FormData) => pedir<void>("POST", "/api/enviar", datos),
  urlHTML: (carpeta: string, uid: number, imagenes: boolean) =>
    `/api/carpetas/${c(carpeta)}/mensajes/${uid}/html${imagenes ? "?imagenes=si" : ""}`,
  urlAdjunto: (carpeta: string, uid: number, indice: number, ver = false) =>
    `/api/carpetas/${c(carpeta)}/mensajes/${uid}/adjuntos/${indice}${ver ? "?ver=si" : ""}`,
};
