import { describe, expect, it } from "vitest";
import { avanzaConEnter, siguienteCampo } from "@/lib/teclado/avance";

/**
 * Se prueba la regla y no el enganche con el navegador porque es donde está el
 * riesgo: un Enter que avanza donde no debe rompe cosas que ya andaban —el
 * renglón de un textarea, el botón de un diálogo— y eso no se nota hasta que
 * alguien pierde lo que estaba escribiendo.
 */
describe("qué campos avanzan con Enter", () => {
  it("avanza en los campos de texto y de número", () => {
    for (const tipo of ["text", "number", "email", "tel", "search", "date"]) {
      expect(avanzaConEnter({ etiqueta: "input", tipo })).toBe(true);
    }
  });

  it("no avanza en un textarea: ahí Enter escribe un renglón", () => {
    expect(avanzaConEnter({ etiqueta: "textarea" })).toBe(false);
  });

  it("no toca los botones ni las casillas", () => {
    expect(avanzaConEnter({ etiqueta: "button" })).toBe(false);
    expect(avanzaConEnter({ etiqueta: "input", tipo: "submit" })).toBe(false);
    expect(avanzaConEnter({ etiqueta: "input", tipo: "checkbox" })).toBe(false);
    expect(avanzaConEnter({ etiqueta: "input", tipo: "radio" })).toBe(false);
  });

  it("deja el select en paz: Enter elige la opción", () => {
    expect(avanzaConEnter({ etiqueta: "select" })).toBe(false);
  });

  it("respeta el escape de cada campo", () => {
    // Un buscador que ya hace algo con Enter lo declara y queda afuera.
    expect(
      avanzaConEnter({ etiqueta: "input", tipo: "text", comportamiento: "enviar" }),
    ).toBe(false);
  });
});

describe("cuál es el campo siguiente", () => {
  it("va al que sigue", () => {
    expect(siguienteCampo(["a", "b", "c"], "b")).toBe("c");
  });

  it("en el último devuelve null, para que Enter envíe", () => {
    // Sin esto el formulario no se puede enviar con el teclado: Enter daría
    // vueltas por los campos para siempre.
    expect(siguienteCampo(["a", "b"], "b")).toBeNull();
  });

  it("ignora un campo que ya no está en la lista", () => {
    expect(siguienteCampo(["a", "b"], "z")).toBeNull();
  });
});
