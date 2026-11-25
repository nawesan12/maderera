import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  faltaIdentificarComprador,
  MONTO_IDENTIFICAR_CONSUMIDOR_FINAL,
} from "@/lib/fiscal/umbral";

/**
 * El umbral de la B en el mostrador.
 *
 * Si el pedido del DNI aparece recién al emitir, el cajero se entera con el
 * cliente delante y la plata en la mano. El mostrador lo pide antes de
 * cobrar, con el mismo número que usa Go para frenar la emisión.
 */
describe("umbral de identificación de la B", () => {
  it("es el mismo número que el de Go", () => {
    const go = readFileSync(join(__dirname, "../backend/internal/fiscal/umbral.go"), "utf8");
    const m = /\{time\.Time\{\}, ([\d_]+)\}/.exec(go);
    expect(m).not.toBeNull();
    expect(Number(m![1].replace(/_/g, ""))).toBe(MONTO_IDENTIFICAR_CONSUMIDOR_FINAL);
  });

  it("pide el documento desde el monto exacto", () => {
    const umbral = MONTO_IDENTIFICAR_CONSUMIDOR_FINAL;
    expect(faltaIdentificarComprador("B", umbral - 0.01, [])).toBe(false);
    expect(faltaIdentificarComprador("B", umbral, [])).toBe(true);
    expect(faltaIdentificarComprador(null, umbral, [null, ""])).toBe(true);
    expect(faltaIdentificarComprador("B", umbral, [null, "30.123.456"])).toBe(false);
    expect(faltaIdentificarComprador("B", umbral, ["20-12345678-6"])).toBe(false);
    expect(faltaIdentificarComprador("B", umbral, ["123"])).toBe(true);
    expect(faltaIdentificarComprador("A", umbral * 2, [])).toBe(false);
  });
});
