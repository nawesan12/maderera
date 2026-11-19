import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

/** Comité final: detalles del sitio público. */
describe("detalles del sitio público", () => {
  it("el asistente dice «Ayuda» y ese es su nombre", () => {
    const barra = leer("components/navbar.tsx");
    const boton = barra.slice(barra.indexOf("onClick={abrirAsistente}") - 200, barra.indexOf(">Ayuda</span>") + 20);
    expect(boton).toContain(">Ayuda</span>");
    // Sin aria-label que tape el texto visible (WCAG 2.5.3) ni texto escondido.
    expect(boton).not.toContain("aria-label");
    expect(boton).not.toMatch(/aria-hidden className="[^"]*">\s*Ayuda/);
  });

  it("Sucursales va en la barra de arriba y en el cajón, no en la de abajo", () => {
    // Medido: con Sucursales, la barra se pasaba del ancho a 1024, 1280 y 1536 px.
    const barra = leer("components/navbar.tsx");
    const directos = barra.slice(barra.indexOf("const enlacesDirectos"), barra.indexOf("];", barra.indexOf("const enlacesDirectos")));
    expect(directos).not.toContain("/sucursales");
    expect(barra).toContain("href={enlaceSucursales.href}");
    expect(barra).toContain("[...enlacesDirectos, enlaceSucursales, ...enlacesMas]");
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
