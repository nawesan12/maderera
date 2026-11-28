import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OPCIONES_DE_REGLAS, valorDeRegla } from "@/lib/reglas";

// Las reglas nacen en la 00290 y en las migraciones que suman otras después
// (cada carril del mes simulado trae las suyas): todas las que siembran
// site_settings.
const carpeta = join(__dirname, "../backend/db/migraciones");
const migracion = readdirSync(carpeta)
  .filter((f) => f.endsWith(".sql") && f >= "00290")
  .map((f) => readFileSync(join(carpeta, f), "utf8"))
  .filter((t) => t.includes("INSERT INTO site_settings"))
  .join("\n");
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
