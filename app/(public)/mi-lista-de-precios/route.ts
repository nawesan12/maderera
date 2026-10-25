import { api, mensajeDe, type Problema } from "@/lib/api/servidor";
import { obtenerConfiguracionFiscal } from "@/lib/fiscal/emitir";
import { pdfDeListaDePrecios } from "@/lib/pdf/lista-precios";

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
 */
export async function GET() {
  // Las filas, con los precios de quien pide, las da la API de Go
  // (backend/internal/catalogo/milista.go): exige sesión —sin esto la lista
  // profesional quedaría a un link de cualquiera— y frena a 10 por hora. El
  // PDF lo arma el TS hasta que se muden los PDF (tanda 12).
  const r = await (await api()).GET("/api/v1/catalogo/mi-lista");
  if (!r.data) {
    const estado = r.response.status;
    const texto =
      estado === 401 ? "Necesitás iniciar sesión." : mensajeDe(r.error as Problema | undefined);
    return new Response(texto, { status: estado === 401 || estado === 429 ? estado : 500 });
  }

  const emisor = await obtenerConfiguracionFiscal();
  const pdf = await pdfDeListaDePrecios({
    titulo: r.data.titulo,
    emisor,
    leyendaIva: "Precios finales con IVA incluido",
    filas: r.data.filas,
  });

  return new Response(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="lista-precios-mjbj-${new Date().toISOString().slice(0, 10)}.pdf"`,
      // Nunca cacheado: el precio depende de quién pregunta.
      "Cache-Control": "no-store, private",
    },
  });
}
