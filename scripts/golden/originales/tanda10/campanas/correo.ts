import "server-only";

import { envolver } from "@/lib/email/plantillas";
import { urlBase } from "@/lib/pagos/config";
import { primerNombre } from "@/lib/formato";
import type { Campana } from "@/lib/db/schema";
import { cuerpoComoParrafos } from "./cuerpo";
import { parametrosDeBaja, secretoDeBajas } from "./baja";

/**
 * El correo de una campaña para una persona.
 *
 * Se arma uno por destinatario porque lleva **su** enlace de baja, firmado con
 * su dirección. Y lleva las dos formas de baja que piden Gmail y Yahoo a quien
 * manda correo masivo desde 2024: el enlace visible en el pie y la cabecera
 * `List-Unsubscribe` con `List-Unsubscribe-Post`, que es el botón «Anular
 * suscripción» que muestran ellos mismos arriba del mensaje. Sin la cabecera,
 * los envíos grandes terminan en spam.
 */
export type CampanaParaArmar = Pick<
  Campana,
  "asunto" | "adelanto" | "cuerpo" | "imagenUrl" | "botonTexto" | "botonUrl"
>;

function absoluta(url: string): string {
  return /^https?:\/\//.test(url) ? url : `${urlBase()}${url.startsWith("/") ? "" : "/"}${url}`;
}

export function armarCorreoDeCampana(
  campana: CampanaParaArmar,
  destinatario: { email: string; nombre: string | null },
) {
  const { e, t } = parametrosDeBaja(destinatario.email, secretoDeBajas());
  const consulta = `e=${e}&t=${t}`;
  const paginaDeBaja = `${urlBase()}/baja?${consulta}`;
  const bajaEnUnClic = `${urlBase()}/api/baja?${consulta}`;

  const { html, texto } = envolver({
    titulo: campana.asunto,
    adelanto: campana.adelanto || campana.asunto,
    saludo: destinatario.nombre ? primerNombre(destinatario.nombre) : undefined,
    parrafos: cuerpoComoParrafos(campana.cuerpo),
    imagen: campana.imagenUrl ? { url: absoluta(campana.imagenUrl), alt: campana.asunto } : undefined,
    cta:
      campana.botonTexto && campana.botonUrl
        ? { texto: campana.botonTexto, url: absoluta(campana.botonUrl) }
        : undefined,
    pie: {
      html: `Te escribimos porque sos cliente de la maderera. Si no querés recibir más novedades, <a href="${paginaDeBaja}" style="color:#7A6F66;">date de baja acá</a>. Los avisos de tus pedidos te van a seguir llegando.`,
      texto: `Si no querés recibir más novedades, date de baja en ${paginaDeBaja}`,
    },
  });

  return {
    asunto: campana.asunto,
    html,
    texto,
    cabeceras: {
      "List-Unsubscribe": `<${bajaEnUnClic}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
