import { afterEach, describe, expect, it, vi } from "vitest";
import { configSmtp } from "@/lib/email/proveedor-smtp";

/**
 * El mismo `.env.produccion` tiene que servir con el servidor de correo propio
 * (contenedor `correo`) y con el correo de Hostinger. El compose pone
 * `SMTP_NOMBRE_TLS=mail.<dominio>` siempre; con un servidor público eso haría
 * fallar la validación del certificado y no saldría ningún aviso.
 */
describe("configSmtp", () => {
  afterEach(() => vi.unstubAllEnvs());

  function entorno(host: string, puerto: string) {
    vi.stubEnv("SMTP_HOST", host);
    vi.stubEnv("SMTP_PUERTO", puerto);
    vi.stubEnv("SMTP_USUARIO", "avisos@mjbj.com.ar");
    vi.stubEnv("SMTP_CLAVE", "x");
    vi.stubEnv("SMTP_NOMBRE_TLS", "mail.mjbj.com.ar");
  }

  it("con el contenedor propio, valida contra el nombre público", () => {
    entorno("correo", "587");
    expect(configSmtp()).toMatchObject({ host: "correo", puerto: 587, nombreTls: "mail.mjbj.com.ar" });
  });

  it("con Hostinger, ignora el nombre TLS del compose", () => {
    entorno("smtp.hostinger.com", "465");
    expect(configSmtp()).toMatchObject({ host: "smtp.hostinger.com", puerto: 465, nombreTls: null });
  });

  it("sin clave no hay SMTP", () => {
    entorno("smtp.hostinger.com", "465");
    vi.stubEnv("SMTP_CLAVE", "");
    expect(configSmtp()).toBeNull();
  });
});
