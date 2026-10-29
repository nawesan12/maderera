import { escapar } from "@/lib/email/plantillas";

/**
 * El cuerpo de una campaña, de texto a HTML de correo.
 *
 * Quien la escribe es la clienta, no alguien que sabe HTML: un campo de texto
 * con tres reglas que se explican en la pantalla. Párrafos separados por una
 * línea en blanco, `- ` al principio arma una lista y `**así**` va en negrita.
 * Las direcciones web se vuelven enlaces solas. Nada más: un editor rico deja
 * pegar estilos de Word que cada programa de correo muestra distinto.
 *
 * Todo se escapa antes de dar formato: lo que se escribe nunca es HTML.
 */
export type BloqueDeCuerpo =
  | { tipo: "parrafo"; html: string; texto: string }
  | { tipo: "lista"; items: { html: string; texto: string }[] };

function enLinea(crudo: string): { html: string; texto: string } {
  let html = escapar(crudo);
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(
    /(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g,
    '<a href="$1" style="color:#B8541A;">$1</a>',
  );
  return { html, texto: crudo.replace(/\*\*(.+?)\*\*/g, "$1") };
}

export function leerCuerpo(cuerpo: string): BloqueDeCuerpo[] {
  return cuerpo
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((bloque) => bloque.trim())
    .filter(Boolean)
    .map((bloque): BloqueDeCuerpo => {
      const lineas = bloque.split("\n").map((l) => l.trim());
      if (lineas.every((l) => /^[-•]\s+/.test(l))) {
        return { tipo: "lista", items: lineas.map((l) => enLinea(l.replace(/^[-•]\s+/, ""))) };
      }
      // Un salto de línea simple dentro de un párrafo se respeta.
      const partes = lineas.map(enLinea);
      return {
        tipo: "parrafo",
        html: partes.map((p) => p.html).join("<br>"),
        texto: partes.map((p) => p.texto).join("\n"),
      };
    });
}

/** Los bloques como párrafos HTML para `envolver`, que los pone uno abajo del otro. */
export function cuerpoComoParrafos(cuerpo: string): string[] {
  return leerCuerpo(cuerpo).map((b) =>
    b.tipo === "parrafo"
      ? b.html
      : `<ul style="margin:0;padding-left:20px;">${b.items
          .map((i) => `<li style="margin:0 0 6px;">${i.html}</li>`)
          .join("")}</ul>`,
  );
}
