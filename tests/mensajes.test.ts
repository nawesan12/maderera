import { describe, expect, it } from "vitest";
import { traducirMensaje } from "@/lib/api/mensajes";

describe("traducirMensaje", () => {
  it("traduce lo de zod y nombra el campo", () => {
    expect(traducirMensaje("Invalid input: expected number, received NaN", "recargoElaboracionPct")).toBe(
      "Recargo por elaboración: tiene que ser un número.",
    );
    expect(traducirMensaje("Too big: expected number to be <=200", "cantidad")).toBe("Cantidad: no puede pasar de 200.");
    expect(traducirMensaje("Too small: expected string to have >=1 characters", "precioPorPasada")).toBe(
      "Precio por pasada: no puede quedar vacío.",
    );
  });

  it("lee el campo del texto cuando Go lo antepone", () => {
    expect(traducirMensaje("anchoSierraMm: Invalid input: expected number, received NaN")).toBe(
      "Ancho de sierra: tiene que ser un número.",
    );
    expect(traducirMensaje("margenSeguridad: Más de 100 % de desperdicio no es un dato")).toBe(
      "Margen seguridad: Más de 100 % de desperdicio no es un dato",
    );
  });

  it("deja pasar lo que ya está en castellano", () => {
    expect(traducirMensaje("Esa placa ya no está disponible para cortar. Elegí otra.")).toBe(
      "Esa placa ya no está disponible para cortar. Elegí otra.",
    );
  });

  it("sin campo, el mensaje solo", () => {
    expect(traducirMensaje("Invalid UUID")).toBe("No es válido.");
  });
});
