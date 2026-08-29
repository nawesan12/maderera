import { describe, expect, it } from "vitest";
import { markdownAHtml, markdownAPlano, markdownATexto } from "@/lib/markdown";

/**
 * Lo que se prueba acá no es el formato: es que el HTML que sale sea seguro. El
 * cuerpo de una nota va a `dangerouslySetInnerHTML`, así que un `<script>`
 * tipeado en el editor no puede salir como script.
 */
describe("markdownAHtml", () => {
  it("escapa el HTML antes de formatear", () => {
    const salida = markdownAHtml('<script>alert("x")</script>');
    expect(salida).not.toContain("<script>");
    expect(salida).toContain("&lt;script&gt;");
  });

  it("escapa el HTML dentro de una negrita", () => {
    const salida = markdownAHtml("**<img src=x onerror=y>**");
    expect(salida).toContain("<strong>");
    expect(salida).not.toContain("<img");
  });

  it("no deja pasar un enlace javascript:", () => {
    const salida = markdownAHtml("[click](javascript:alert(1))");
    expect(salida).not.toContain("<a href");
  });

  it("acepta enlaces http y relativos", () => {
    expect(markdownAHtml("[a](https://mjbj.ar)")).toContain(
      '<a href="https://mjbj.ar">a</a>',
    );
    expect(markdownAHtml("[b](/catalogo)")).toContain('<a href="/catalogo">b</a>');
  });

  it("arma encabezados y párrafos", () => {
    const salida = markdownAHtml("## Título\n\nUn párrafo.");
    expect(salida).toContain("<h2>Título</h2>");
    expect(salida).toContain("<p>Un párrafo.</p>");
  });

  it("agrupa los ítems en una sola lista", () => {
    const salida = markdownAHtml("- uno\n- dos\n\nDespués.");
    expect(salida).toContain("<ul><li>uno</li><li>dos</li></ul>");
    expect((salida.match(/<ul>/g) ?? []).length).toBe(1);
  });

  it("separa listas cuando hay un párrafo en el medio", () => {
    const salida = markdownAHtml("- uno\n\nTexto\n\n- dos");
    expect((salida.match(/<ul>/g) ?? []).length).toBe(2);
  });

  it("con texto vacío no rompe", () => {
    expect(markdownAHtml("")).toBe("");
  });
});

describe("markdownATexto", () => {
  it("quita el formato", () => {
    expect(markdownATexto("## Hola **mundo**")).toBe("Hola mundo");
  });

  it("deja el texto de los enlaces", () => {
    expect(markdownATexto("Ver el [catálogo](/catalogo) ahora")).toBe(
      "Ver el catálogo ahora",
    );
  });

  it("corta sin partir palabras", () => {
    const largo = "palabra ".repeat(40);
    const salida = markdownATexto(largo, 30);
    expect(salida.length).toBeLessThanOrEqual(31);
    expect(salida.endsWith("…")).toBe(true);
    expect(salida).not.toContain("palabr…");
  });

  it("no corta lo que ya entra", () => {
    expect(markdownATexto("Corto", 100)).toBe("Corto");
  });
});

/**
 * Las tablas y el código entraron con las guías del panel. Lo que se prueba
 * sigue siendo lo mismo: que nada de lo que entra pueda salir como HTML.
 */
describe("párrafos", () => {
  it("une los renglones seguidos en un solo párrafo", () => {
    // Un texto escrito a 80 columnas es un párrafo, no cinco.
    const salida = markdownAHtml("Una frase larga\nque sigue acá.");
    expect(salida).toBe("<p>Una frase larga que sigue acá.</p>");
  });

  it("corta el párrafo en el renglón en blanco", () => {
    const salida = markdownAHtml("Primero.\n\nSegundo.");
    expect(salida).toBe("<p>Primero.</p>\n<p>Segundo.</p>");
  });

  it("cierra el párrafo al empezar una lista", () => {
    const salida = markdownAHtml("Hay tres:\n- uno\n- dos");
    expect(salida).toBe("<p>Hay tres:</p>\n<ul><li>uno</li><li>dos</li></ul>");
  });

  it("continúa el ítem de lista que sigue en el renglón de abajo", () => {
    const salida = markdownAHtml("- Un ítem largo\n  que sigue acá.\n- Otro");
    expect(salida).toBe(
      "<ul><li>Un ítem largo que sigue acá.</li><li>Otro</li></ul>",
    );
  });

  it("cierra una negrita que abre en un renglón y termina en el siguiente", () => {
    const salida = markdownAHtml("**Esto es una\nnegrita larga**, y sigue.");
    expect(salida).toBe("<p><strong>Esto es una negrita larga</strong>, y sigue.</p>");
  });

  it("cierra el párrafo al empezar una tabla", () => {
    const salida = markdownAHtml("Así queda:\n| a |\n|---|\n| b |");
    expect(salida).toContain("<p>Así queda:</p>");
    expect(salida).toContain("<table>");
  });
});

describe("tablas y código", () => {
  it("arma una tabla con encabezado y cuerpo", () => {
    const salida = markdownAHtml(
      ["| Estado | Qué es |", "|---|---|", "| Listo | Se puede retirar |"].join("\n"),
    );

    expect(salida).toContain("<th>Estado</th>");
    expect(salida).toContain("<td>Listo</td>");
    expect(salida).not.toContain("---");
  });

  it("escapa el HTML dentro de una celda", () => {
    const salida = markdownAHtml(
      ["| a | b |", "|---|---|", "| <img src=x onerror=y> | ok |"].join("\n"),
    );

    expect(salida).not.toContain("<img");
    expect(salida).toContain("&lt;img");
  });

  it("no interpreta lo que está dentro de un bloque de código", () => {
    const salida = markdownAHtml(["```", "**no es negrita**", "```"].join("\n"));

    expect(salida).toContain("<pre><code>");
    expect(salida).not.toContain("<strong>");
    expect(salida).toContain("**no es negrita**");
  });

  it("cierra un bloque de código que quedó abierto", () => {
    // Perder el contenido por una comilla que faltaba sería peor que mostrarlo
    // sin formato.
    const salida = markdownAHtml(["```", "algo importante"].join("\n"));
    expect(salida).toContain("algo importante");
  });

  it("escapa el HTML dentro de un bloque de código", () => {
    const salida = markdownAHtml(["```", "<script>x</script>", "```"].join("\n"));
    expect(salida).not.toContain("<script>");
  });

  it("no confunde una línea suelta que empieza con tubo", () => {
    const salida = markdownAHtml("| esto no es una tabla |");
    expect(salida).not.toContain("<table>");
    expect(salida).toContain("<p>");
  });

  it("no abre un código con una comilla sin cerrar", () => {
    // Si el tramo final se tomara como código, se comería el resto de la línea.
    const salida = markdownAHtml("Queda `pendiente de revisar");
    expect(salida).not.toContain("<code>");
    expect(salida).toContain("`pendiente de revisar");
  });

  it("no busca negritas ni enlaces adentro del código en línea", () => {
    const salida = markdownAHtml("Se escribe `**así**` para la negrita.");
    expect(salida).toContain("<code>**así**</code>");
    expect(salida).not.toContain("<strong>");
  });
});

describe("markdownAPlano", () => {
  it("saca las marcas y deja una sola línea", () => {
    expect(markdownAPlano("## Título\n\nUn **texto** con `código`.")).toBe(
      "Título Un texto con código.",
    );
  });

  it("mantiene legible una tabla", () => {
    // La búsqueda en las guías cae seguido dentro de una tabla: si el renglón
    // se perdiera, el resultado saldría sin contexto.
    const plano = markdownAPlano(
      ["| Estado | Qué es |", "|---|---|", "| Listo | Se puede retirar |"].join("\n"),
    );

    expect(plano).toBe("Estado — Qué es Listo — Se puede retirar");
    expect(plano).not.toContain("---");
  });
});
