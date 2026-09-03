import { type NextRequest } from "next/server";
import { copiaDelMostrador } from "@/lib/dal/admin/mostrador-offline";
import { conStaff, leerDesde } from "../guardia";

/**
 * El catálogo para la copia local: variantes, precios y stock.
 *
 * Con `?desde=` devuelve solo lo que cambió desde entonces. Sin él, todo.
 */
export async function GET(request: NextRequest) {
  return conStaff(() => copiaDelMostrador(leerDesde(request.nextUrl)));
}
