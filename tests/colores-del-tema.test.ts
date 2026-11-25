import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/*
 * Los rojos y verdes de Tailwind con número (text-green-900, bg-red-700…) no
 * tienen variante oscura: en oscuro, «Autorizada por ARCA · CAE» quedaba a
 * 1,69:1 y el error al anular un recibo a 3,1:1 (comité del 25/11). Van los
 * tokens del tema, que sí la tienen: text-saldo-debe y text-saldo-favor,
 * bg-destructive, o una familia .estado-* que pinta el texto por su cuenta.
 */
describe("los colores de estado salen del tema", () => {
  it("no quedan rojos ni verdes de Tailwind con número en app/ ni components/", () => {
    let salida = "";
    try {
      salida = execSync(
        `grep -rnE "\\b(text|bg|border|ring|fill|stroke)-(green|red)-[0-9]{2,3}\\b" app components`,
        { encoding: "utf8" },
      );
    } catch {
      salida = ""; // grep sin coincidencias sale con 1
    }
    expect(salida.trim()).toBe("");
  });
});
