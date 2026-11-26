import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OPCIONES_DE_REGLAS, valorDeRegla } from "@/lib/reglas";

const migracion = readFileSync(
  join(__dirname, "../backend/db/migraciones/00290_reglas_que_esperan_al_contador.sql"),
  "utf8",
);
const go = readFileSync(join(__dirname, "../backend/internal/reglas/reglas.go"), "utf8");

describe("reglas que esperan al contador", () => {
  it("arrancan igual que en la migración", () => {
    for (const [clave, opciones] of Object.entries(OPCIONES_DE_REGLAS)) {
      expect(migracion).toContain(`('${clave}', '${opciones[0]}'`);
    }
  });

  it("tienen las mismas opciones que Go", () => {
    for (const [clave, opciones] of Object.entries(OPCIONES_DE_REGLAS)) {
      const constante = new RegExp(`(\\w+)\\s*=\\s*"${clave}"`).exec(go)?.[1];
      expect(constante, clave).toBeTruthy();
      const fila = new RegExp(`\\b${constante}:\\s*\\{([^}]*)\\}`).exec(go)?.[1];
      expect(fila?.match(/"[^"]+"/g)?.map((s) => s.slice(1, -1)), clave).toEqual([...opciones]);
    }
  });

  it("lo que falta o no es una opción vale el de arranque", () => {
    expect(valorDeRegla({}, "venta_reconocida")).toBe("entregar_o_facturar");
    expect(valorDeRegla({ venta_reconocida: "x" }, "venta_reconocida")).toBe("entregar_o_facturar");
    expect(valorDeRegla({ venta_reconocida: "tomar" }, "venta_reconocida")).toBe("tomar");
  });
});
