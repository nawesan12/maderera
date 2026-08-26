import { describe, expect, it } from "vitest";
import { markdownAHtml, markdownATexto } from "@/lib/markdown";

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
