import { execFileSync, spawnSync } from "node:child_process";
import { createECDH } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import webpush from "web-push";

/**
 * El script que genera las claves VAPID (`scripts/claves-push.sh`).
 *
 * Se prueba porque saca las claves cortando bytes de un DER a mano, y un error
 * ahí no se ve hasta que la clienta activa los avisos en el teléfono y no le
 * llega nada. Lo que importa: que la pública corresponda a la privada, que
 * `web-push` las acepte, y que nunca pise un par que ya existe.
 */
const SCRIPT = join(__dirname, "..", "scripts", "claves-push.sh");

let carpeta: string | null = null;
afterEach(() => {
  if (carpeta) rmSync(carpeta, { recursive: true, force: true });
  carpeta = null;
});

function leer(texto: string) {
  const valor = (nombre: string) => texto.match(new RegExp(`^${nombre}="([^"]+)"`, "m"))?.[1];
  return {
    publica: valor("VAPID_PUBLIC_KEY")!,
    privada: valor("VAPID_PRIVATE_KEY")!,
    subject: valor("VAPID_SUBJECT")!,
  };
}

describe("las claves de los avisos", () => {
  it("genera un par que corresponde y que web-push acepta", () => {
    const claves = leer(execFileSync("bash", [SCRIPT], { encoding: "utf8" }));

    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(Buffer.from(claves.privada, "base64url"));
    expect(ecdh.getPublicKey().toString("base64url")).toBe(claves.publica);

    expect(claves.subject).toBe("mailto:info@mjbj.com.ar");
    expect(() =>
      webpush.setVapidDetails(claves.subject, claves.publica, claves.privada),
    ).not.toThrow();
  });

  it("cada corrida da un par distinto", () => {
    const una = leer(execFileSync("bash", [SCRIPT], { encoding: "utf8" }));
    const otra = leer(execFileSync("bash", [SCRIPT], { encoding: "utf8" }));
    expect(una.privada).not.toBe(otra.privada);
  });

  it("las agrega a un archivo, pero no pisa las que ya están", () => {
    carpeta = mkdtempSync(join(tmpdir(), "claves-push-"));
    const archivo = join(carpeta, ".env.produccion");
    writeFileSync(archivo, 'APP_URL="https://mjbj.com.ar"\n');

    execFileSync("bash", [SCRIPT, archivo], { encoding: "utf8" });
    const primera = readFileSync(archivo, "utf8");
    expect(primera).toContain('APP_URL="https://mjbj.com.ar"');
    expect(leer(primera).publica).toHaveLength(87);

    const segunda = spawnSync("bash", [SCRIPT, archivo], { encoding: "utf8" });
    expect(segunda.status).toBe(1);
    expect(segunda.stderr).toContain("ya tiene VAPID_PUBLIC_KEY");
    expect(readFileSync(archivo, "utf8")).toBe(primera);
  });
});
