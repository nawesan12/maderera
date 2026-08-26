import { describe, expect, it } from "vitest";
import { envolver, escapar } from "@/lib/email/plantillas";

/**
 * El cuerpo de los correos se arma con HTML concatenado, y `parrafos` entra
 * crudo a propósito para que las plantillas propias puedan poner negritas.
 * Eso deja una sola regla: lo que viene de afuera pasa por `escapar` antes.
 * El formulario de contacto es el caso —lo escribe cualquiera y termina en la
 * bandeja de quien atiende—, así que se prueba.
 */

describe("escapado del cuerpo del correo", () => {
  it("neutraliza las etiquetas de una consulta", () => {
    const { html } = envolver({
      titulo: "Consulta desde el sitio",
      adelanto: "prueba",
      parrafos: [escapar('<script>alert("hola")</script>')],
    });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("no deja cerrar un atributo desde el texto", () => {
    // El clásico: un mensaje que arranca con comillas para escaparse del
    // atributo y agregar un `onerror`.
    const { html } = envolver({
      titulo: "Consulta",
      adelanto: "prueba",
      parrafos: [escapar('" onmouseover="robar()')],
    });

    expect(html).not.toContain('onmouseover="robar()');
    expect(html).toContain("&quot;");
  });

  it("escapa también las etiquetas y valores de los datos", () => {
    const { html } = envolver({
      titulo: "Consulta",
      adelanto: "prueba",
      parrafos: ["Hola"],
      datos: [{ etiqueta: "Nombre", valor: "<img src=x onerror=1>" }],
    });

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("la versión en texto plano no arrastra el HTML", () => {
    // Un correo solo-HTML puntúa peor en los filtros de spam, así que la
    // versión de texto tiene que existir y estar limpia.
    const { texto } = envolver({
      titulo: "Consulta",
      adelanto: "prueba",
      parrafos: ["<strong>Importante</strong>"],
    });

    expect(texto).toContain("Importante");
    expect(texto).not.toContain("<strong>");
  });
});
