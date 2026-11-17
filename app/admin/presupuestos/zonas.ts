import "server-only";
import { listarZonasDeEnvio } from "@/lib/dal/envios";
import type { ZonaParaPedido } from "./acciones";

/** Las zonas del flete, para el paso de presupuesto a pedido. */
export async function zonasParaPedido(): Promise<ZonaParaPedido[]> {
  return (await listarZonasDeEnvio()).map((z) => ({ nombre: z.nombre, costo: z.costo, aCotizar: z.aCotizar }));
}
