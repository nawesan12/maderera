import { describe, expect, it } from "vitest";
import { normalizar } from "@/lib/asistente/lenguaje";

/**
 * El motor del asistente vive en Go (backend/internal/asistente, con sus
 * casos en lenguaje_test.go). Acá queda `normalizar`, que usa el cortador y
 * tiene que dar lo mismo que asistente.Normalizar.
 */
describe("normalizar", () => {
  it("saca acentos y mayúsculas, como f_unaccent en la base", () => {
    expect(normalizar("Fenólico")).toBe("fenolico");
    expect(normalizar("MELAMÍNICA")).toBe("melaminica");
    expect(normalizar("  cañería   ")).toBe("caneria");
  });

  it("conserva lo que hace falta para leer medidas", () => {
    expect(normalizar("2440x1220")).toBe("2440x1220");
    expect(normalizar("18 mm.")).toBe("18 mm.");
  });
});

describe("el mensaje de WhatsApp del asistente", () => {
  it("lleva lo escrito tal cual, no «consultar por necesito…» (mes 23)", async () => {
    const { mensajeDesdeElAsistente } = await import("@/lib/asistente/lenguaje");
    expect(mensajeDesdeElAsistente("necesito tirantes de 3 metros")).toBe(
      "Hola! Vengo de la web. Necesito tirantes de 3 metros.",
    );
    expect(mensajeDesdeElAsistente("  ¿tienen fenólico?  ")).toBe("Hola! Vengo de la web. ¿Tienen fenólico?");
    expect(mensajeDesdeElAsistente("")).toBe("Hola! Vengo de la web.");
  });
});
