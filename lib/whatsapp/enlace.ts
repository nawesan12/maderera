import "server-only";
import { ajuste } from "@/lib/dal/contenido";

/**
 * El enlace de WhatsApp del negocio, desde una sola fuente.
 *
 * El número estaba escrito a mano en catorce archivos, y encima en dos formas
 * distintas: los enlaces decían `542235903118` y el ajuste del panel
 * —el que se publica en los datos estructurados— dice `5492235903118`. Para un
 * celular argentino el `9` después del 54 no es opcional, así que la versión
 * escrita a mano era la mal formada.
 *
 * Ahora sale del ajuste `whatsapp_principal`, que es editable desde el panel y
 * viaja cacheado con el resto de los ajustes del sitio, así que preguntarlo en
 * cada página no cuesta una consulta.
 *
 * @param texto Mensaje con el que se abre la conversación, sin codificar.
 */
export async function enlaceWhatsapp(texto?: string): Promise<string> {
  const numero = (await ajuste("whatsapp_principal", "5492235903118")).replace(
    /\D/g,
    "",
  );
  const base = `https://wa.me/${numero}`;
  return texto ? `${base}?text=${encodeURIComponent(texto)}` : base;
}

/**
 * Solo el número, en dígitos, para los componentes de cliente que arman el
 * enlace ellos mismos y lo reciben por prop.
 */
export async function numeroWhatsapp(): Promise<string> {
  return (await ajuste("whatsapp_principal", "5492235903118")).replace(/\D/g, "");
}
