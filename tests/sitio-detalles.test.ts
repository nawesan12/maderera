import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

/** Comité final: detalles del sitio público. */
describe("detalles del sitio público", () => {
  it("el asistente tiene rótulo entre lg y 2xl", () => {
    const barra = leer("components/navbar.tsx");
    expect(barra).toMatch(/2xl:hidden">\s*Ayuda\s*<\/span>/);
  });

  it("el WhatsApp flotante se va mientras se escribe en el teléfono", () => {
    const css = leer("app/globals.css");
    expect(css).toMatch(/@media \(max-width: 639px\) \{\s*body:has\(:is\(input[^)]*\)[^{]*:focus\) \.flotante-whatsapp \{\s*display: none;/);
  });

  it("el verde de WhatsApp queda para WhatsApp", () => {
    expect(leer("components/footer.tsx")).not.toContain("#25D366");
    const respuesta = leer("app/(public)/mi-cuenta/presupuestos/respuesta.tsx");
    expect(respuesta).not.toContain("bg-verde-whatsapp");
    expect(respuesta).not.toContain("brand-green");
  });
});
