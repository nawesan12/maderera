import { redirect } from "next/navigation";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

/**
 * Descarga la lista de precios como planilla o como PDF.
 *
 * Respeta los filtros que están puestos en pantalla: si alguien filtró por
 * Molduras, baja las molduras. Exportar siempre el catálogo entero obligaría a
 * borrar filas a mano antes de trabajar.
 *
 * Dos formatos, dos usos distintos. El CSV es para trabajar la planilla y
 * volver a subirla. El PDF es lo que se le manda a un cliente que pide la
 * lista —el brief lo pone entre la documentación descargable para
 * profesionales— y por eso lleva membrete, fecha de vigencia y el precio de
 * la lista que se pidió (`lista=profesional`).
 *
 * Los dos los arma Go (backend/internal/documentos, tanda 12), que también
 * exige que quien pide sea del panel.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = {
    formato: searchParams.get("formato") === "pdf" ? ("pdf" as const) : ("csv" as const),
    ...(searchParams.get("buscar") ? { buscar: searchParams.get("buscar")! } : {}),
    ...(searchParams.get("cat") ? { cat: searchParams.get("cat")! } : {}),
    ...(searchParams.get("lista") ? { lista: searchParams.get("lista")! } : {}),
  };

  const r = await (await api()).GET("/api/v1/documentos/precios", { params: { query }, parseAs: "stream" });
  if (!r.data) {
    const estado = r.response.status;
    // Como hacía requireStaff: sin sesión, a entrar; sin ser del panel, al inicio.
    if (estado === 401) redirect("/ingresar");
    if (estado === 403) redirect("/");
    return new Response(mensajeDe(r.error as Problema | undefined), { status: 500 });
  }

  return new Response(r.data, {
    headers: {
      "Content-Type": r.response.headers.get("Content-Type") ?? "application/octet-stream",
      "Content-Disposition": r.response.headers.get("Content-Disposition") ?? "attachment",
      "Cache-Control": "no-store",
    },
  });
}
