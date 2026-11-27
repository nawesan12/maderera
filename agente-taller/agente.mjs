#!/usr/bin/env node
/**
 * Agente del taller.
 *
 * Corre en la PC del aserradero, al lado de la seccionadora. Cada tanto le
 * pregunta a la plataforma qué cortes hay en cola y deja el archivo de cada uno
 * en la carpeta que vigila el optimizador. Nadie tiene que bajar nada a mano.
 *
 * Tres decisiones que conviene entender antes de tocarlo:
 *
 * 1. **No sabe nada del formato.** Pide el archivo ya armado a la plataforma,
 *    que lo genera con el perfil configurado en `/admin/cortes/formato`. Cuando
 *    se vea la máquina real y haya que corregir columnas o separador, se
 *    cambia el perfil desde el navegador y este archivo no se toca.
 *
 * 2. **Lleva su propio registro** en `estado.json`, al lado de este archivo. El
 *    servidor no marca nada como exportado: si el agente se reinstala o se
 *    corre en dos máquinas, lo peor que pasa es que reescriba un archivo, no
 *    que un corte quede marcado como enviado sin haber llegado.
 *
 * 3. **Escribe con nombre temporal y después renombra.** Un optimizador que
 *    vigila la carpeta puede leer el archivo a medio escribir; el renombrado es
 *    atómico en el mismo sistema de archivos, así que o está entero o no está.
 *
 * 4. **En la carpeta queda solo lo que se puede cortar.** El archivo de un
 *    corte que salió de la cola (terminado, anulado o reemplazado por uno
 *    corregido) pasa a `fuera-de-cola/`: si no, el CRT-6 anulado quedaba al
 *    lado del CRT-8 que lo corrige y se podía cortar con las medidas viejas
 *    (mes simulado, M2S1-014). El que está en la máquina se queda.
 *
 * 5. **Reescribe solo si cambió el contenido.** Empezar y deshacer en el
 *    taller cambia la fecha del corte, no sus piezas, y un optimizador que
 *    vigila la carpeta toma un archivo reescrito como trabajo nuevo (M2S1-146).
 *
 * Uso:
 *   MJBJ_URL=https://mjbj.com.ar \
 *   MJBJ_TOKEN=xxxxx \
 *   MJBJ_CARPETA="C:/CutRite/Entrada" \
 *   MJBJ_SUCURSAL="Aserradero" \
 *   node agente.mjs
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const ESTADO = join(AQUI, "estado.json");

const URL_BASE = (process.env.MJBJ_URL ?? "").replace(/\/$/, "");
const TOKEN = process.env.MJBJ_TOKEN ?? "";
const CARPETA = process.env.MJBJ_CARPETA ?? "";
const CADA_SEGUNDOS = Number(process.env.MJBJ_INTERVALO ?? 60);
// El taller de esta PC (el nombre de la sucursal o su id). Vacío: todos.
const SUCURSAL = (process.env.MJBJ_SUCURSAL ?? "").trim();
const FUERA_DE_COLA = "fuera-de-cola";

/** La hora del registro en 24 h: «23:08:21», no «11:08:21» sin a. m. ni p. m. */
function hora() {
  return new Date().toLocaleTimeString("es-AR", { hour12: false });
}

function huella(contenido) {
  return createHash("sha256").update(contenido).digest("hex");
}

async function existe(ruta) {
  try {
    await stat(ruta);
    return true;
  } catch {
    return false;
  }
}

function faltaConfig() {
  const faltan = [
    !URL_BASE && "MJBJ_URL",
    !TOKEN && "MJBJ_TOKEN",
    !CARPETA && "MJBJ_CARPETA",
  ].filter(Boolean);
  return faltan.length ? faltan : null;
}

async function leerEstado() {
  try {
    return JSON.parse(await readFile(ESTADO, "utf8"));
  } catch {
    // Primera corrida, o el archivo quedó corrupto. Empezar de cero solo
    // significa volver a escribir los cortes que hoy están en cola.
    return { escritos: {} };
  }
}

async function guardarEstado(estado) {
  if (process.env.MJBJ_SIN_ESTADO) return;
  await writeFile(ESTADO, JSON.stringify(estado, null, 2), "utf8");
}

async function pedir(ruta) {
  const respuesta = await fetch(URL_BASE + ruta, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });

  if (respuesta.status === 401) {
    throw new Error("El token no es válido. Revisar MJBJ_TOKEN.");
  }
  if (respuesta.status === 400) {
    throw new Error((await respuesta.text()) || `${ruta} respondió 400`);
  }
  if (respuesta.status === 404) {
    throw new Error(
      "La plataforma no tiene la integración activada: falta CORTES_AGENTE_TOKEN del lado del servidor.",
    );
  }
  if (!respuesta.ok) {
    throw new Error(`${ruta} respondió ${respuesta.status}`);
  }
  return respuesta;
}

/** El nombre que viene en `Content-Disposition`, o uno armado con el número. */
function nombreDelArchivo(respuesta, numero) {
  const cd = respuesta.headers.get("content-disposition") ?? "";
  const m = cd.match(/filename="?([^";]+)"?/i);
  return m ? m[1] : `corte-${numero}.csv`;
}

/** Lo escrito de un corte. Los estado.json de antes guardaban solo la fecha. */
function escritoDe(estado, id) {
  const e = estado.escritos[id];
  if (!e) return null;
  return typeof e === "string" ? { actualizado: e } : e;
}

export async function unaVuelta(estado) {
  const consulta = SUCURSAL ? `?sucursal=${encodeURIComponent(SUCURSAL)}` : "";
  const { cortes, enLaMaquina = [] } = await (await pedir("/api/cortes/pendientes" + consulta)).json();

  let nuevos = 0;
  let cambio = false;

  for (const corte of cortes) {
    const yaEscrito = escritoDe(estado, corte.id);
    // Si cambió el corte después de que lo bajamos, se vuelve a bajar: en el
    // mostrador se corrigen medidas y el archivo viejo cortaría mal.
    if (yaEscrito?.actualizado === corte.actualizado) continue;

    const respuesta = await pedir(`/api/cortes/${corte.id}/lista`);
    const contenido = Buffer.from(await respuesta.arrayBuffer());
    const nombre = nombreDelArchivo(respuesta, corte.numero);
    const destino = join(CARPETA, nombre);
    const firma = huella(contenido);

    // Mismo contenido y el archivo sigue ahí: no se toca.
    if (yaEscrito?.huella === firma && yaEscrito.nombre === nombre && (await existe(destino))) {
      estado.escritos[corte.id] = { ...yaEscrito, actualizado: corte.actualizado };
      cambio = true;
      continue;
    }

    const temporal = `${destino}.parcial`;
    await writeFile(temporal, contenido);
    await rename(temporal, destino);

    estado.escritos[corte.id] = { actualizado: corte.actualizado, nombre, huella: firma };
    nuevos += 1;
    cambio = true;
    console.log(`· ${corte.numero} → ${nombre}${corte.urgente ? "  (urgente)" : ""}`);
  }

  // Lo que salió de la cola y no está en la máquina: afuera de la carpeta.
  const vigentes = new Set([...cortes, ...enLaMaquina].map((c) => c.id));
  for (const id of Object.keys(estado.escritos)) {
    if (vigentes.has(id)) continue;
    const { nombre } = escritoDe(estado, id);
    if (nombre && (await existe(join(CARPETA, nombre)))) {
      await mkdir(join(CARPETA, FUERA_DE_COLA), { recursive: true });
      await rename(join(CARPETA, nombre), join(CARPETA, FUERA_DE_COLA, nombre));
      console.log(`· ${nombre} → ${FUERA_DE_COLA}/`);
    }
    delete estado.escritos[id];
    cambio = true;
  }

  if (cambio) await guardarEstado(estado);
  return { total: cortes.length, nuevos };
}

async function main() {
  const faltan = faltaConfig();
  if (faltan) {
    console.error("Falta configurar: " + faltan.join(", "));
    console.error("Ver el encabezado de este archivo para el uso.");
    process.exit(1);
  }

  await mkdir(CARPETA, { recursive: true });
  const estado = await leerEstado();

  console.log(`Agente del taller · ${URL_BASE}${SUCURSAL ? ` · ${SUCURSAL}` : ""}`);
  console.log(`Dejando archivos en ${CARPETA}, cada ${CADA_SEGUNDOS}s.\n`);

  for (;;) {
    try {
      const { total, nuevos } = await unaVuelta(estado);
      if (nuevos === 0) {
        console.log(`${hora()} · ${total} en cola, nada nuevo`);
      }
    } catch (error) {
      // Un error no corta el agente: la máquina del taller se queda sin red a
      // cada rato y volver a levantarlo a mano no va a pasar.
      console.error(`${hora()} · ${error.message}`);
    }
    await new Promise((r) => setTimeout(r, CADA_SEGUNDOS * 1000));
  }
}

// Importado (desde la prueba) no arranca el bucle.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
