import { describe, expect, it } from "vitest";
import { claveAlAbrir } from "@/lib/cobros/clave";

describe("la clave del cobro", () => {
  let n = 0;
  const nueva = () => `clave-${++n}`;

  it("nace al abrir, también desde afuera («Cobrar y entregar»)", () => {
    const primera = claveAlAbrir(false, true, "inicial", nueva);
    expect(primera).not.toBe("inicial");
    // Cerrar no la cambia (un reintento con la respuesta perdida la reusa
    // mientras el diálogo siga abierto).
    expect(claveAlAbrir(true, false, primera, nueva)).toBe(primera);
    expect(claveAlAbrir(true, true, primera, nueva)).toBe(primera);
    // El segundo cobro, abierto otra vez desde afuera, lleva otra.
    const segunda = claveAlAbrir(false, true, primera, nueva);
    expect(segunda).not.toBe(primera);
  });
});
