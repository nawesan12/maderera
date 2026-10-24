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
}

export interface Mensaje extends Omit<Resumen, "adjuntos"> {
  cc: Direccion[];
  responderA: Direccion[];
  messageId?: string;
  referencias?: string[];
  texto: string;
  tieneHtml: boolean;
  imagenesRemotas: boolean;
  adjuntos: Adjunto[];
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
  | "restaurar";

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

export const api = {
  sesion: () => pedir<{ correo: string }>("GET", "/api/sesion"),
  entrar: (correo: string, clave: string) => pedir<{ correo: string }>("POST", "/api/sesion", { correo, clave }),
  salir: () => pedir<void>("DELETE", "/api/sesion"),
  carpetas: () => pedir<Carpeta[]>("GET", "/api/carpetas"),
  lista: (carpeta: string, pagina = 1, q = "") =>
    pedir<Pagina>(
      "GET",
      `/api/carpetas/${c(carpeta)}/mensajes?` + new URLSearchParams(q ? { q } : { pagina: String(pagina) }),
    ),
  mensaje: (carpeta: string, uid: number) => pedir<Mensaje>("GET", `/api/carpetas/${c(carpeta)}/mensajes/${uid}`),
  acciones: (carpeta: string, uids: number[], accion: Accion, destino?: string) =>
    pedir<void>("POST", `/api/carpetas/${c(carpeta)}/acciones`, { uids, accion, destino }),
  enviar: (datos: FormData) => pedir<void>("POST", "/api/enviar", datos),
  urlHTML: (carpeta: string, uid: number, imagenes: boolean) =>
    `/api/carpetas/${c(carpeta)}/mensajes/${uid}/html${imagenes ? "?imagenes=si" : ""}`,
  urlAdjunto: (carpeta: string, uid: number, indice: number, ver = false) =>
    `/api/carpetas/${c(carpeta)}/mensajes/${uid}/adjuntos/${indice}${ver ? "?ver=si" : ""}`,
};
