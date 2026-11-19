import { API_URL, cabecerasDelPedido } from "@/lib/api/servidor";

/**
 * Sube el padrón mensual de ARBA a Go tal como llega, sin leerlo acá.
 *
 * Es un route handler y no una server action porque el archivo anda por los
 * 200 MB: una server action lo cargaría entero en memoria (y Next corta a
 * 1 MB). Se pasa el cuerpo como un stream y Go lo lee renglón por renglón,
 * quedándose con los CUIT de los clientes. Go mira que quien pide sea admin.
 */
export async function POST(request: Request) {
  if (!request.body) return Response.json({ error: "Elegí el archivo del padrón." }, { status: 422 });
  const r = await fetch(`${API_URL}/api/v1/admin/facturacion/padron-iibb`, {
    method: "POST",
    headers: { ...(await cabecerasDelPedido()), "content-type": "application/octet-stream" },
    body: request.body,
    // Node exige decirlo para mandar un stream como cuerpo.
    duplex: "half",
    cache: "no-store",
  } as RequestInit & { duplex: "half" });
  const cuerpo = await r.json().catch(() => null);
  if (!r.ok) {
    const mensaje =
      (cuerpo?.errores && Object.values(cuerpo.errores as Record<string, string>)[0]) ??
      cuerpo?.detail ??
      "No se pudo cargar el padrón.";
    return Response.json({ error: mensaje }, { status: r.status === 401 || r.status === 403 ? r.status : 422 });
  }
  return Response.json(cuerpo);
}
