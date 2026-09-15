import { describe, expect, it } from "vitest";
import { sirveLoGuardado } from "@/lib/precios-propios-context";

/**
 * La regla que decide si los precios que quedaron en una pestaña son de quien
 * la está mirando.
 *
 * **El caso que existe para evitar es concreto y pasó:** el profesional cierra
 * sesión en la computadora del mostrador, entra el siguiente en la misma
 * pestaña, y los precios de la lista anterior se le mostraban como propios.
 * La señal cambia en cada inicio de sesión, y lo guardado lleva con cuál se
 * pidió: si no coinciden, no sirve.
 *
 * Todo lo que no sea una coincidencia exacta cae del lado seguro —precio de
 * público— porque de menos nunca es un problema y de más es el error que no se
 * puede cometer.
 */
describe("sirveLoGuardado", () => {
  it("sirve cuando lo guardado es de la misma sesión", () => {
    expect(sirveLoGuardado({ senal: "abc123" }, "abc123")).toBe(true);
  });

  it("no sirve lo que guardó otra sesión", () => {
    expect(sirveLoGuardado({ senal: "abc123" }, "def456")).toBe(false);
  });

  it("no sirve lo guardado antes de que la señal llevara valor", () => {
    expect(sirveLoGuardado({ senal: undefined }, "abc123")).toBe(false);
    expect(sirveLoGuardado({ senal: null }, "abc123")).toBe(false);
  });

  it("sin señal no sirve nada, aunque lo guardado diga tenerla", () => {
    expect(sirveLoGuardado({ senal: "abc123" }, null)).toBe(false);
    // Ni siquiera dos ausencias se consideran iguales: sin sesión el precio es
    // el de público y no hay nada que corregir.
    expect(sirveLoGuardado({ senal: null }, null)).toBe(false);
  });

  it("sin nada guardado no sirve", () => {
    expect(sirveLoGuardado(null, "abc123")).toBe(false);
  });
});
