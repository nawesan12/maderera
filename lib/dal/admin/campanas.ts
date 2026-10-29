import "server-only";

import { api, datos } from "@/lib/api/servidor";
import type { Esquemas } from "@/lib/api/tipos";

/**
 * Lo que lee el panel de campañas. Solo el admin (ver `lib/roles.ts`). Lo
 * sirve la API de Go (backend/internal/campanas): las campañas con sus
 * conteos, el segmento ya dicho en castellano (`descripcion`) y, en la
 * ficha, el correo armado para un cliente de muestra (`muestra`).
 */

type ConFechas<T> = Omit<T, "programadaPara" | "iniciadaAt" | "terminadaAt" | "createdAt" | "updatedAt"> & {
  programadaPara: Date | null;
  iniciadaAt: Date | null;
  terminadaAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ResumenDeCampana = ConFechas<Esquemas["CampanaResumen"]>;
export type DetalleDeCampana = ConFechas<Esquemas["CampanaDetalle"]>;
export type SegmentoCampana = Esquemas["SegmentoCampana"];

const fecha = (s: string | null | undefined) => (s ? new Date(s) : null);

function conFechas<T extends Esquemas["CampanaResumen"]>(c: T) {
  return {
    ...c,
    programadaPara: fecha(c.programadaPara),
    iniciadaAt: fecha(c.iniciadaAt),
    terminadaAt: fecha(c.terminadaAt),
    createdAt: new Date(c.createdAt),
    updatedAt: new Date(c.updatedAt),
  };
}

export async function listarCampanas(): Promise<ResumenDeCampana[]> {
  return datos(await (await api()).GET("/api/v1/admin/campanas")).map(conFechas);
}

export async function obtenerCampana(id: string): Promise<DetalleDeCampana | null> {
  const r = await (await api()).GET("/api/v1/admin/campanas/{id}", { params: { path: { id } } });
  if (r.response.status === 404) return null;
  return conFechas(datos(r));
}

/** Los que no salieron, con el motivo: es lo único que hay que mirar de un envío. */
export async function fallidosDeCampana(id: string) {
  return datos(await (await api()).GET("/api/v1/admin/campanas/{id}/fallidos", { params: { path: { id } } }));
}

/**
 * Si las campañas pueden salir (`motivo`, o null), si el envío de correos
 * está conectado, a cuántas por minuto y cuántas bajas hay.
 */
export async function estadoDeCampanas() {
  return datos(await (await api()).GET("/api/v1/admin/campanas/estado"));
}
