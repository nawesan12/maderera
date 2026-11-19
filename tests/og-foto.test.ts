import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fotoParaTarjeta } from "@/app/og/foto";

/**
 * La tarjeta que se ve al compartir un enlace por WhatsApp. Las fotos de la
 * biblioteca y las portadas propias son WebP, y el generador no las entiende:
 * se descartaban y el enlace salía sin foto. Ahora se pasan a JPEG.
 */
function responder(datos: Buffer, tipo: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array(datos), { headers: { "content-type": tipo } })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("la foto de la tarjeta para compartir", () => {
  it("un WebP sale como JPEG de 1200 px como mucho", async () => {
    const webp = await sharp({ create: { width: 1920, height: 1440, channels: 3, background: "#c8a070" } })
      .webp()
      .toBuffer();
    responder(webp, "image/webp");
    const foto = await fotoParaTarjeta("/subidas/producto-1.webp");
    expect(foto).toMatch(/^data:image\/jpeg;base64,/);
    const jpeg = Buffer.from(foto!.split(",")[1], "base64");
    const m = await sharp(jpeg).metadata();
    expect(m.format).toBe("jpeg");
    expect(m.width).toBe(1200);
  });

  it("un JPEG pasa tal cual", async () => {
    const jpeg = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#000" } }).jpeg().toBuffer();
    responder(jpeg, "image/jpeg");
    expect(await fotoParaTarjeta("/sitio/placas-v1.jpg")).toBe(`data:image/jpeg;base64,${jpeg.toString("base64")}`);
  });

  it("lo que no es una imagen, sin foto", async () => {
    responder(Buffer.from("<html>"), "text/html");
    expect(await fotoParaTarjeta("/x")).toBeNull();
    expect(await fotoParaTarjeta(null)).toBeNull();
  });
});
