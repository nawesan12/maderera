/**
 * Markdown acotado para las notas del blog.
 *
 * Soporta lo que el contenido usa de verdad: encabezados de segundo y tercer
 * nivel, listas, negritas, cursivas y enlaces. Nada más.
 *
 * Se escribe a mano en vez de sumar una librería porque el conjunto es chico y
 * cerrado, y porque el problema real de renderizar Markdown en una página no es
 * el parseo sino el HTML que se inyecta después: **acá se escapa todo primero y
 * recién después se agregan las etiquetas**, así que una nota con `<script>` en
 * el cuerpo sale como texto y no como script. Una librería general hace lo
 * contrario por defecto y hay que acordarse de sanear.
 *
 * Sin `server-only`: es una función pura y se puede probar.
 */

function escapar(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Negritas, cursivas y enlaces dentro de una línea ya escapada. */
function conFormatoDeLinea(texto: string): string {
  return (
    texto
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
      // Solo http y https: un enlace `javascript:` en el cuerpo de una nota es
      // exactamente el agujero que este módulo evita.
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g,
        '<a href="$2">$1</a>',
      )
  );
}

/**
 * Convierte Markdown a HTML.
 *
 * Devuelve HTML ya seguro para pasar a `dangerouslySetInnerHTML`: el nombre de
 * esa prop es una advertencia razonable, y lo que la vuelve aceptable acá es
 * que el escapado pasa antes que cualquier otra cosa.
 */
export function markdownAHtml(markdown: string): string {
  const bloques: string[] = [];
  let lista: string[] = [];

  function cerrarLista() {
    if (lista.length === 0) return;
    bloques.push(`<ul>${lista.map((i) => `<li>${i}</li>`).join("")}</ul>`);
    lista = [];
  }

  for (const linea of escapar(markdown).split("\n")) {
    const limpia = linea.trim();

    if (!limpia) {
      cerrarLista();
      continue;
    }

    if (limpia.startsWith("### ")) {
      cerrarLista();
      bloques.push(`<h3>${conFormatoDeLinea(limpia.slice(4))}</h3>`);
      continue;
    }

    if (limpia.startsWith("## ")) {
      cerrarLista();
      bloques.push(`<h2>${conFormatoDeLinea(limpia.slice(3))}</h2>`);
      continue;
    }

    if (limpia.startsWith("- ") || limpia.startsWith("* ")) {
      lista.push(conFormatoDeLinea(limpia.slice(2)));
      continue;
    }

    if (limpia.startsWith("> ")) {
      cerrarLista();
      bloques.push(
        `<blockquote>${conFormatoDeLinea(limpia.slice(2))}</blockquote>`,
      );
      continue;
    }

    cerrarLista();
    bloques.push(`<p>${conFormatoDeLinea(limpia)}</p>`);
  }

  cerrarLista();

  return bloques.join("\n");
}

/** Texto plano de un Markdown, para descripciones y adelantos. */
export function markdownATexto(markdown: string, largo = 160): string {
  const plano = markdown
    .replace(/[#>*_`]/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  if (plano.length <= largo) return plano;

  // Se corta en el último espacio para no partir una palabra al medio.
  const recorte = plano.slice(0, largo);
  const ultimo = recorte.lastIndexOf(" ");

  return `${recorte.slice(0, ultimo > 0 ? ultimo : largo)}…`;
}
