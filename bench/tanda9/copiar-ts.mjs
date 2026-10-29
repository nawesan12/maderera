// Saca de la historia el TS de WhatsApp de antes de la mudanza (git 9a17128)
// a bench/tanda9/ts/, con los imports apuntando a las copias y la sesión
// stubeada. Ver README.md.
//
//   node bench/tanda9/copiar-ts.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const COMMIT = "9a17128";
const destino = new URL("./ts/", import.meta.url);
mkdirSync(new URL("whatsapp/", destino), { recursive: true });

const modulos = ["index", "tipos", "config", "proveedor-demo", "proveedor-cloud", "errores", "numeros", "plantillas", "plantillas-base",
  "catalogo", "ventana", "costos", "gasto", "firma", "payload", "ingesta", "envio", "medios", "webhook", "documentos"];

const cambiar = (texto, rel) =>
  texto
    .replaceAll('"@/lib/whatsapp/', `"${rel}whatsapp/`)
    .replaceAll('"@/lib/whatsapp"', `"${rel}whatsapp/index"`)
    .replaceAll('"@/lib/dal/session"', `"${rel}sesion"`)
    .replaceAll('"./avisos"', '"../avisos"')
    .replaceAll('"next/cache"', `"${rel}sin-next"`);

for (const m of modulos) {
  const t = execFileSync("git", ["show", `${COMMIT}:lib/whatsapp/${m}.ts`], { encoding: "utf8" });
  writeFileSync(new URL(`whatsapp/${m}.ts`, destino), `// @ts-nocheck: copiado tal cual de git ${COMMIT}, ver ../../README.md.\n` + cambiar(t, "../"));
}
const dal = execFileSync("git", ["show", `${COMMIT}:lib/dal/admin/whatsapp.ts`], { encoding: "utf8" });
writeFileSync(new URL("dal-whatsapp.ts", destino), `// @ts-nocheck: copiado tal cual de git ${COMMIT}, ver ../README.md.\n` + cambiar(dal, "./").replaceAll('"./whatsapp/avisos"', '"./avisos"'));
console.log(`${modulos.length + 1} archivos en ${destino.pathname}`);
