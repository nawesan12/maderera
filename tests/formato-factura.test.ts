import { describe, expect, it } from "vitest";
import { cantidadConUnidad, decimalesDeLaColumna, unitarioConDecimales, unitarioQueCierra } from "@/lib/formato";

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

describe("la columna del unitario (M4-018, M4-031)", () => {
  it("va toda con los decimales del renglón que más necesita, y cada renglón cierra", () => {
    const renglones = [
      { subtotal: 477685.95, cantidad: 20 },
      { subtotal: 277685.95, cantidad: 30 },
      { subtotal: 31834.71, cantidad: 2 },
    ];
    const d = decimalesDeLaColumna(renglones);
    expect(d).toBe(4);
    expect(sinEspacio(unitarioConDecimales(31834.71, 2, d))).toBe("$ 15.917,3550");
    expect(sinEspacio(unitarioConDecimales(477685.95, 20, d))).toBe("$ 23.884,2975");
    expect(decimalesDeLaColumna([{ subtotal: 24200, cantidad: 2 }])).toBe(2);
    expect(sinEspacio(unitarioConDecimales(24200, 2, 2))).toBe("$ 12.100,00");
  });
});
