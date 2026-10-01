import { describe, expect, it } from "vitest";
import { queHacerConLaSenal } from "@/lib/estado-context";

/**
 * La regla que decide si lo que dice el encabezado sigue siendo de quien mira.
 *
 * **El caso que existe para evitar es concreto y pasó:** el profesional cierra
 * sesión en la computadora del mostrador, entra el siguiente en la misma
 * pestaña, y se le mostraba lo del anterior. La señal cambia en cada inicio de
 * sesión, y lo que resolvió el servidor lleva con cuál se resolvió: si no
 * coinciden, no sirve.
 *
 * Antes la regla cuidaba los precios guardados en la pestaña. Ya no se guardan
 * —cada página los trae del servidor—, pero el encabezado vive en el layout y
 * no se rearma al navegar, así que la misma regla sigue haciendo falta ahí.
 */
describe("queHacerConLaSenal", () => {
  it("con la misma señal no hay nada que hacer", () => {
    expect(queHacerConLaSenal("abc123", "abc123")).toBe("nada");
  });

  it("sin señal antes ni ahora tampoco: es alguien sin nada, y no se pregunta", () => {
    expect(queHacerConLaSenal(null, null)).toBe("nada");
  });

  it("con otra señal es otra sesión, y se vuelve a preguntar", () => {
    expect(queHacerConLaSenal("abc123", "def456")).toBe("preguntar");
  });

  it("si apareció una señal —entró, o agregó algo al carrito— se pregunta", () => {
    expect(queHacerConLaSenal(null, "abc123")).toBe("preguntar");
  });

  it("si la señal se fue, se olvida lo que se sabía sin preguntar", () => {
    expect(queHacerConLaSenal("abc123", null)).toBe("olvidar");
  });
});
