/**
 * Markdown acotado para las notas del blog y las guías del panel.
 *
 * Soporta lo que el contenido usa de verdad: encabezados de segundo y tercer
 * nivel, listas, negritas, cursivas, enlaces, código y tablas. Nada más.
 *
 * Las tablas y el código entraron con las guías de uso: media guía es "esto
 * significa aquello" y una lista de guiones se lee mucho peor que dos columnas.
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

/** Negritas, cursivas y enlaces. No toca el código, que ya vino resuelto. */
function conEnfasis(texto: string): string {
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
 * Negritas, cursivas, código y enlaces dentro de una línea ya escapada.
 *
 * El código se aparta **antes** de buscar lo demás, cortando la línea en
 * tramos alternados. Reemplazarlo primero y seguir de largo no alcanza: dejaba
 * el contenido adentro del `<code>` expuesto a las pasadas siguientes, y
 * escribir `` `**así**` `` para explicar cómo se pone una negrita salía en
 * negrita en vez de salir como ejemplo.
 */
function conFormatoDeLinea(texto: string): string {
  const tramos = texto.split("`");

  // Con una comilla sin cerrar queda un tramo suelto al final: ese vuelve a ser
  // texto, con su comilla, en vez de convertirse en un código abierto que se
  // come el resto de la línea.
  const sinCerrar = tramos.length % 2 === 0;
  const ultimo = tramos.length - 1;

  return tramos
    .map((tramo, i) => {
      if (i % 2 === 0) return conEnfasis(tramo);
      if (sinCerrar && i === ultimo) return conEnfasis(`\`${tramo}`);
      return `<code>${tramo}</code>`;
    })
    .join("");
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
  let tabla: string[] = [];
  /**
   * Renglones sueltos que todavía no se cerraron en un párrafo.
   *
   * En Markdown un párrafo termina con un renglón en blanco, no con el salto de
   * línea: un texto escrito a 80 columnas es **un** párrafo. Antes cada renglón
   * salía como un `<p>` propio, y un archivo con los renglones cortados —como
   * las guías— se leía con un espacio de más entre cada frase.
   *
   * Se guardan **sin formatear**: el formato se aplica al texto ya unido,
   * porque una negrita que abre en un renglón y cierra en el siguiente hay que
   * verla entera para cerrarla.
   */
  let parrafo: string[] = [];
  /** Renglones acumulados de un bloque de código, o `null` si no hay uno abierto. */
  let codigo: string[] | null = null;

  function cerrarLista() {
    if (lista.length === 0) return;
    bloques.push(
      `<ul>${lista.map((i) => `<li>${conFormatoDeLinea(i)}</li>`).join("")}</ul>`,
    );
    lista = [];
  }

  function cerrarParrafo() {
    if (parrafo.length === 0) return;
    bloques.push(`<p>${conFormatoDeLinea(parrafo.join(" "))}</p>`);
    parrafo = [];
  }

  /** Parte `| a | b |` en celdas, sin los tubos de los extremos. */
  function celdas(fila: string): string[] {
    return fila
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());
  }

  /**
   * Cierra una tabla: el primer renglón es el encabezado y el segundo es el de
   * los guiones, que se descarta. Una tabla de un solo renglón sale como
   * párrafos: era una línea que empezaba con un tubo, no una tabla.
   */
  function cerrarTabla() {
    if (tabla.length === 0) return;

    if (tabla.length < 2) {
      for (const fila of tabla) bloques.push(`<p>${conFormatoDeLinea(fila)}</p>`);
      tabla = [];
      return;
    }

    const encabezado = celdas(tabla[0]);
    const cuerpo = tabla.slice(2).map(celdas);

    bloques.push(
      `<table><thead><tr>${encabezado
        .map((c) => `<th>${conFormatoDeLinea(c)}</th>`)
        .join("")}</tr></thead><tbody>${cuerpo
        .map(
          (fila) =>
            `<tr>${fila.map((c) => `<td>${conFormatoDeLinea(c)}</td>`).join("")}</tr>`,
        )
        .join("")}</tbody></table>`,
    );
    tabla = [];
  }

  function cerrarBloques() {
    cerrarParrafo();
    cerrarLista();
    cerrarTabla();
  }

  for (const linea of escapar(markdown).split("\n")) {
    const limpia = linea.trim();

    // Dentro de un bloque de código no se interpreta nada: el contenido se
    // guarda tal cual, que es todo el punto de haberlo abierto.
    if (limpia.startsWith("```")) {
      if (codigo === null) {
        cerrarBloques();
        codigo = [];
      } else {
        bloques.push(`<pre><code>${codigo.join("\n")}</code></pre>`);
        codigo = null;
      }
      continue;
    }

    if (codigo !== null) {
      codigo.push(linea);
      continue;
    }

    // El renglón de guiones que separa el encabezado del cuerpo.
    if (tabla.length > 0 && /^\|[\s:|-]+\|$/.test(limpia)) {
      tabla.push(limpia);
      continue;
    }

    if (limpia.startsWith("|") && limpia.endsWith("|")) {
      cerrarParrafo();
      cerrarLista();
      tabla.push(limpia);
      continue;
    }

    cerrarTabla();

    if (!limpia) {
      cerrarParrafo();
      cerrarLista();
      continue;
    }

    if (limpia.startsWith("### ")) {
      cerrarParrafo();
      cerrarLista();
      bloques.push(`<h3>${conFormatoDeLinea(limpia.slice(4))}</h3>`);
      continue;
    }

    if (limpia.startsWith("## ")) {
      cerrarParrafo();
      cerrarLista();
      bloques.push(`<h2>${conFormatoDeLinea(limpia.slice(3))}</h2>`);
      continue;
    }

    if (limpia.startsWith("- ") || limpia.startsWith("* ")) {
      cerrarParrafo();
      lista.push(limpia.slice(2));
      continue;
    }

    if (limpia.startsWith("> ")) {
      cerrarParrafo();
      cerrarLista();
      bloques.push(
        `<blockquote>${conFormatoDeLinea(limpia.slice(2))}</blockquote>`,
      );
      continue;
    }

    // Un renglón suelto mientras hay una lista abierta continúa el último
    // ítem, no arranca un párrafo: es cómo se ve un ítem largo en un archivo
    // con los renglones cortados. Antes la segunda mitad de la frase salía
    // como un párrafo aparte, fuera de la viñeta.
    if (lista.length > 0 && parrafo.length === 0) {
      lista[lista.length - 1] += ` ${limpia}`;
      continue;
    }

    cerrarLista();
    parrafo.push(limpia);
  }

  // Un bloque de código sin cerrar no se descarta: sale igual, porque perder el
  // contenido por una comilla que faltaba es peor que mostrarlo mal.
  if (codigo !== null) {
    bloques.push(`<pre><code>${codigo.join("\n")}</code></pre>`);
  }

  cerrarBloques();

  return bloques.join("\n");
}

/**
 * Markdown sin sus marcas, en una sola línea.
 *
 * Lo usan el adelanto de una nota y la búsqueda en las guías. Los renglones de
 * las tablas se separan con un guion largo en vez de perderse: un resultado de
 * búsqueda que cae dentro de una tabla tiene que seguir leyéndose.
 */
export function markdownAPlano(markdown: string): string {
  return markdown
    .split("\n")
    // El renglón de guiones de una tabla no dice nada.
    .filter((l) => !/^\s*\|[\s:|-]+\|\s*$/.test(l))
    .map((l) =>
      l.trimStart().startsWith("|")
        ? l.replace(/^\s*\||\|\s*$/g, "").split("|").map((c) => c.trim()).join(" — ")
        : l,
    )
    .join("\n")
    .replace(/```/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Texto plano de un Markdown, recortado, para descripciones y adelantos. */
export function markdownATexto(markdown: string, largo = 160): string {
  const plano = markdownAPlano(markdown);

  if (plano.length <= largo) return plano;

  // Se corta en el último espacio para no partir una palabra al medio.
  const recorte = plano.slice(0, largo);
  const ultimo = recorte.lastIndexOf(" ");

  return `${recorte.slice(0, ultimo > 0 ? ultimo : largo)}…`;
}
