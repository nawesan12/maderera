import { describe, expect, it } from "vitest";
import { enlaceDeSeguimiento } from "@/lib/seguimiento";

/**
 * El número de pedido es consecutivo y sin huecos porque se dice por teléfono y
 * va en el remito. Eso lo vuelve enumerable, así que lo que autoriza la página
 * de seguimiento es el token, no el número.
 *
 * Se prueba el armado del enlace y no la autorización —que necesita base— para
 * cubrir la forma en que esto se rompe de verdad: alguien vuelve a escribir la
 * URL a mano en un lugar nuevo y se olvida el token.
 */
describe("enlaceDeSeguimiento", () => {
  it("siempre lleva el token", () => {
    const enlace = enlaceDeSeguimiento("PED-1207", "64db8354-3f71-4c48-9f1d-fd073b0ff3cc");
    expect(enlace).toBe(
      "/pedido/PED-1207?t=64db8354-3f71-4c48-9f1d-fd073b0ff3cc",
    );
  });

  it("escapa el número", () => {
    // El número lo genera el sistema, pero la migración del sistema viejo puede
    // traer cualquier cosa: si trae una barra, no puede inventar una ruta.
    expect(enlaceDeSeguimiento("PED/1207", "abc")).toBe("/pedido/PED%2F1207?t=abc");
  });
});
