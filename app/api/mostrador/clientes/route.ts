import { type NextRequest } from "next/server";
import { clientesDelMostrador } from "@/lib/dal/admin/mostrador-offline";
import { conStaff, leerDesde } from "../guardia";

/** El padrón de clientes para la copia local. */
export async function GET(request: NextRequest) {
  return conStaff(() => clientesDelMostrador(leerDesde(request.nextUrl)));
}
