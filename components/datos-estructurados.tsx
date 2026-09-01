import type { JsonLd } from "@/lib/seo";

/**
 * Inserta datos estructurados en la página.
 *
 * Un solo lugar donde vive el `dangerouslySetInnerHTML`, que es lo que
 * permite auditarlo de una: el contenido nunca es texto del usuario, es un
 * objeto que se serializa acá, y `</script>` se escapa por si algún día un
 * nombre de producto lo trae adentro.
 */
export function DatosEstructurados({ datos }: { datos: JsonLd | JsonLd[] }) {
  const json = JSON.stringify(datos).replace(/</g, "\\u003c");

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
