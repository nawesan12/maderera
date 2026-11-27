import { describe, expect, it } from "vitest";
import { SUCURSALES, conWhatsappDelSitio } from "@/lib/sucursales";

describe("conWhatsappDelSitio", () => {
  it("Casa Central lleva el número del panel y el aserradero el suyo", () => {
    const [central, aserradero] = conWhatsappDelSitio(SUCURSALES, "+54 9 223 555-0999");
    expect(central!.slug).toBe("casa-central");
    expect(central!.whatsapp).toBe("5492235550999");
    expect(aserradero!.whatsapp).toBe("5492235060817");
  });

  it("sin número cargado queda la constante", () => {
    expect(conWhatsappDelSitio(SUCURSALES, "")[0]!.whatsapp).toBe("5492235903118");
  });
});
