import { describe, expect, it } from "vitest";
import { cantidadConUnidad, unitarioQueCierra } from "@/lib/formato";

const sinEspacio = (s: string) => s.replace(/\s/g, " ");

describe("unitarioQueCierra (M3S2-063, M2S1-154)", () => {
  it("usa los decimales que hacen falta para que cantidad × unitario dé el subtotal", () => {
    expect(sinEspacio(unitarioQueCierra(10701, 13))).toBe("$ 823,154");
    expect(sinEspacio(unitarioQueCierra(294285.12, 5))).toBe("$ 58.857,024");
    expect(sinEspacio(unitarioQueCierra(24200, 2))).toBe("$ 12.100");
    expect(sinEspacio(unitarioQueCierra(100, 0))).toBe("$ 100");
  });
});

describe("la media placa (M2S3-096)", () => {
  it("se cuenta por medias", () => {
    expect(cantidadConUnidad(1, "placa", "MDF 18 mm — Media placa, al largo")).toBe("1 media");
    expect(cantidadConUnidad(2, "placa", "MDF 18 mm — Media placa, al ancho")).toBe("2 medias");
    expect(cantidadConUnidad(2, "placa", "MDF 18 mm")).toBe("2 placas");
  });
});
