import { describe, expect, it } from "vitest";
import { ERROR_DE_RED, sinRomper } from "@/lib/acciones/sin-romper";

describe("sinRomper", () => {
  it("devuelve lo que devuelve la acción", async () => {
    const a = sinRomper<{ error?: string; ok?: string }>(async () => ({ ok: "Listo" }));
    expect(await a({}, new FormData())).toEqual({ ok: "Listo" });
  });
  it("una acción que se corta vuelve como error del formulario", async () => {
    const a = sinRomper<{ error?: string; ok?: string }>(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await a({}, new FormData())).toEqual({ ok: undefined, error: ERROR_DE_RED });
  });
});
