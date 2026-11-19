import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ATAJOS,
  accionDeLaTecla,
  enterDelBuscador,
  type Tecla,
} from "@/lib/mostrador/atajos";

/**
 * Las teclas del mostrador, con eventos falsos.
 *
 * El error que motivó esto (T4, hallazgo 18): Ctrl+Enter en el buscador
 * agregaba la línea y la tecla seguía hasta `window`, donde cobraba el
 * carrito armado antes de que la línea entrara. No se ve leyendo el código:
 * se ve con la plata mal cobrada.
 */

const tecla = (t: Partial<Tecla>): Tecla => ({
  code: "",
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  defaultPrevented: false,
  ...t,
});

const nada = () => false;
const ctrlEnter = tecla({ code: "Enter", ctrlKey: true });

describe("los atajos de la pantalla", () => {
  it("Ctrl+Enter cobra (y Cmd+Enter en Mac, y el Enter del teclado numérico)", () => {
    expect(accionDeLaTecla(ctrlEnter, ATAJOS, nada)).toBe("cobrar");
    expect(accionDeLaTecla(tecla({ code: "Enter", metaKey: true }), ATAJOS, nada)).toBe("cobrar");
    expect(accionDeLaTecla(tecla({ code: "NumpadEnter", ctrlKey: true }), ATAJOS, nada)).toBe("cobrar");
  });

  it("una tecla que un campo ya usó no llega a la pantalla", () => {
    expect(accionDeLaTecla({ ...ctrlEnter, defaultPrevented: true }, ATAJOS, nada)).toBeNull();
  });

  it("con un diálogo encima la pantalla de atrás no escucha", () => {
    expect(accionDeLaTecla(ctrlEnter, ATAJOS, () => true)).toBeNull();
    expect(accionDeLaTecla(tecla({ code: "KeyK", altKey: true }), ATAJOS, () => true)).toBeNull();
  });

  it("Mayús o Alt sobre Ctrl+Enter no cobran: son las teclas de la media placa", () => {
    expect(accionDeLaTecla(tecla({ code: "Enter", ctrlKey: true, shiftKey: true }), ATAJOS, nada)).toBeNull();
    expect(accionDeLaTecla(tecla({ code: "Enter", ctrlKey: true, altKey: true }), ATAJOS, nada)).toBeNull();
    expect(accionDeLaTecla(tecla({ code: "Enter", shiftKey: true }), ATAJOS, nada)).toBeNull();
    expect(accionDeLaTecla(tecla({ code: "Enter", altKey: true }), ATAJOS, nada)).toBeNull();
  });

  it("los de Alt van sin otros modificadores", () => {
    expect(accionDeLaTecla(tecla({ code: "KeyC", altKey: true }), ATAJOS, nada)).toBe("cliente");
    expect(accionDeLaTecla(tecla({ code: "KeyC", altKey: true, shiftKey: true }), ATAJOS, nada)).toBeNull();
    expect(accionDeLaTecla(tecla({ code: "KeyC", altKey: true, ctrlKey: true }), ATAJOS, nada)).toBeNull();
    expect(accionDeLaTecla(tecla({ code: "KeyC" }), ATAJOS, nada)).toBeNull();
  });

  it("la pantalla escucha en burbuja: en captura, defaultPrevented llega siempre en falso", () => {
    // Si alguien agrega `true` o `{ capture: true }`, el atajo corre antes que
    // el `onKeyDown` del buscador y Ctrl+Enter vuelve a cobrar sin la línea.
    const fuente = readFileSync(new URL("../app/mostrador/atajos.tsx", import.meta.url), "utf8");
    expect(fuente).toMatch(/window\.addEventListener\("keydown", alApretar\);/);
  });
});

describe("el Enter del buscador", () => {
  const base = { ctrl: false, shift: false, alt: false, texto: "", hayResultado: false, seCorta: false, resuelto: false };

  it("vacío, suelta la tecla: Ctrl+Enter cobra como siempre", () => {
    expect(enterDelBuscador({ ...base, ctrl: true })).toEqual({ que: "soltar" });
    expect(enterDelBuscador({ ...base, ctrl: true, texto: "   " })).toEqual({ que: "soltar" });
  });

  it("Ctrl+Enter sobre un resultado agrega y cobra con la línea ya adentro", () => {
    expect(enterDelBuscador({ ...base, ctrl: true, texto: "pino", hayResultado: true, resuelto: true })).toEqual({
      que: "agregar",
      media: null,
      yCobrar: true,
    });
  });

  it("Enter solo agrega y no cobra", () => {
    expect(enterDelBuscador({ ...base, texto: "pino", hayResultado: true })).toEqual({
      que: "agregar",
      media: null,
      yCobrar: false,
    });
  });

  it("una placa que se corta abre el corte y no cobra, aunque el diálogo no esté montado", () => {
    expect(enterDelBuscador({ ...base, ctrl: true, texto: "mdf", hayResultado: true, seCorta: true })).toEqual({
      que: "cortar",
    });
  });

  it("Mayús y Alt son media placa y nunca cobran, aunque venga Ctrl", () => {
    expect(enterDelBuscador({ ...base, shift: true, texto: "mdf", hayResultado: true })).toMatchObject({
      media: "media_largo",
      yCobrar: false,
    });
    expect(enterDelBuscador({ ...base, alt: true, texto: "mdf", hayResultado: true })).toMatchObject({
      media: "media_ancho",
      yCobrar: false,
    });
    expect(
      enterDelBuscador({ ...base, ctrl: true, shift: true, texto: "mdf", hayResultado: true, seCorta: true }),
    ).toMatchObject({ que: "agregar", media: "media_largo", yCobrar: false });
  });

  it("un código que no existe no cobra: abre la carga a mano", () => {
    expect(enterDelBuscador({ ...base, ctrl: true, texto: "7790000", resuelto: true })).toEqual({ que: "aMano" });
  });

  it("mientras busca se queda con la tecla y espera", () => {
    expect(enterDelBuscador({ ...base, ctrl: true, texto: "pi" })).toEqual({ que: "esperar" });
    // «3*» todavía no es una búsqueda, pero ya hay algo escrito.
    expect(enterDelBuscador({ ...base, ctrl: true, texto: "3*" })).toEqual({ que: "esperar" });
  });
});
