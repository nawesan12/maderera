import "server-only";

import { api, datos } from "@/lib/api/servidor";

/**
 * La configuración de los avisos por correo y su bitácora. Solo el admin
 * (el ACCESO de /admin/avisos). Lo sirve la API de Go
 * (backend/internal/avisos): siembra los avisos que falten y los devuelve en
 * el orden del ciclo de un pedido.
 */

export interface AvisoEmailConfigurable {
  id: string;
  evento: string;
  asunto: string;
  encabezado: string | null;
  activo: boolean;
}

export async function listarAvisosEmail(): Promise<AvisoEmailConfigurable[]> {
  return datos(await (await api()).GET("/api/v1/admin/avisos"));
}

export interface EstadoCorreo {
  enVivo: boolean;
  remitente: string;
  detalle: string;
}

export async function estadoCorreo(): Promise<EstadoCorreo> {
  return datos(await (await api()).GET("/api/v1/admin/avisos/correo"));
}

export interface AvisoEnviado {
  id: string;
  canal: string;
  evento: string;
  destinatario: string;
  asunto: string | null;
  estado: string;
  error: string | null;
  createdAt: Date;
}

/**
 * Bitácora de avisos.
 *
 * Es la pantalla a la que ir cuando alguien dice que nunca le llegó nada. Los
 * dos canales van juntos: la pregunta nunca es "¿le mandamos el mail?", es
 * "¿le avisamos?".
 */
export async function ultimosAvisosEnviados(limite = 40): Promise<AvisoEnviado[]> {
  const filas = datos(await (await api()).GET("/api/v1/admin/avisos/enviados", { params: { query: { limite } } }));
  return filas.map((f) => ({ ...f, createdAt: new Date(f.createdAt) }));
}
