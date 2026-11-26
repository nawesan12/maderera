import { redirect } from "next/navigation";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

/**
 * La lista de precios del cliente, en PDF.
 *
 * El brief la pide entre la documentación descargable para profesionales:
 * "Listas de precios PDF". Un mayorista que quiere cotizar una obra necesita
 * la lista entera en un papel, no ir producto por producto por el catálogo.
 *
 * **Cada uno baja la suya.** La lista sale de `Vigente` en Go, la misma
 * función que resuelve el precio del catálogo: quien tiene lista
 * profesional baja los precios profesionales y quien no, los de público. Es la
 * regla que evita el peor error de este módulo —una lista mayorista servida a
 * cualquiera—, y por eso se resuelve en el servidor y nunca desde un parámetro
 * de la URL.
 *
 * El PDF entero lo arma Go (backend/internal/documentos, tanda 12): exige
 * sesión —sin esto la lista profesional quedaría a un link de cualquiera— y
 * frena a 10 por hora. Esta ruta queda para que la dirección no cambie.
 */
export async function GET() {
  const r = await (await api()).GET("/api/v1/documentos/mi-lista-de-precios", { parseAs: "stream" });
  if (!r.data) {
    const estado = r.response.status;
    // Sin sesión, a entrar y volver. Con la tienda apagada la lista no sale
    // (catalogo.ExigirTienda: los precios se apagan para todos, profesionales
    // incluidos, decisión del 9/11): en vez de un 403 en texto plano, a la
    // página de profesionales (mes simulado, H086).
    if (estado === 401) redirect("/ingresar?volver=/mi-lista-de-precios");
    if (estado === 403) redirect("/profesionales");
    const texto = mensajeDe(r.error as Problema | undefined);
    return new Response(texto, { status: estado === 429 ? 429 : 500 });
  }

  return new Response(r.data, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": r.response.headers.get("Content-Disposition") ?? "inline",
      // Nunca cacheado: el precio depende de quién pide.
      "Cache-Control": "no-store, private",
    },
  });
}
