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
 * Uso:
 *   MJBJ_URL=https://mjbj.com.ar \
 *   MJBJ_TOKEN=xxxxx \
 *   MJBJ_CARPETA="C:/CutRite/Entrada" \
 *   node agente.mjs
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const ESTADO = join(AQUI, "estado.json");

const URL_BASE = (process.env.MJBJ_URL ?? "").replace(/\/$/, "");
const TOKEN = process.env.MJBJ_TOKEN ?? "";
const CARPETA = process.env.MJBJ_CARPETA ?? "";
const CADA_SEGUNDOS = Number(process.env.MJBJ_INTERVALO ?? 60);

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
  await writeFile(ESTADO, JSON.stringify(estado, null, 2), "utf8");
}

async function pedir(ruta) {
  const respuesta = await fetch(URL_BASE + ruta, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });

  if (respuesta.status === 401) {
    throw new Error("El token no es válido. Revisar MJBJ_TOKEN.");
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

/** Lo anotado de un corte: antes era solo la fecha; ahora también el archivo. */
function anotado(valor) {
  return typeof valor === "string" ? { actualizado: valor, archivo: null } : valor;
}

/**
 * Saca de la carpeta los archivos de los cortes que ya no están ni en la cola
 * ni en la máquina: terminados, anulados o reemplazados por una corrección
 * (mes simulado: CRT-28.csv quedaba con 1200 mm al lado de CRT-30.csv con
 * 1180, y el optimizador podía cortar el viejo). No se borran: van a
 * `hechos/`, por si hay que mirar qué se mandó.
 *
 * Solo si la plataforma dice qué está en la máquina (`enProceso`): una más
 * vieja no lo manda, y sin eso no se puede saber si el archivo sigue haciendo
 * falta.
 */
async function sacarLosQueSalieron(estado, cortes, enProceso) {
  if (!Array.isArray(enProceso)) return 0;
  const siguen = new Set([...cortes.map((c) => c.id), ...enProceso]);
  const hechos = join(CARPETA, "hechos");
  let sacados = 0;
  for (const [id, valor] of Object.entries(estado.escritos)) {
    if (siguen.has(id)) continue;
    const { archivo } = anotado(valor);
    if (archivo && existsSync(join(CARPETA, archivo))) {
      await mkdir(hechos, { recursive: true });
      await rename(join(CARPETA, archivo), join(hechos, archivo));
      console.log(`· ${archivo} → hechos/`);
    }
    delete estado.escritos[id];
    sacados += 1;
  }
  return sacados;
}

async function unaVuelta(estado) {
  const { cortes, enProceso } = await (await pedir("/api/cortes/pendientes")).json();

  let nuevos = await sacarLosQueSalieron(estado, cortes, enProceso);

  for (const corte of cortes) {
    const yaEscrito = anotado(estado.escritos[corte.id]);
    // Si cambió el corte después de que lo bajamos, se vuelve a escribir: en el
    // mostrador se corrigen medidas y el archivo viejo cortaría mal.
    if (yaEscrito?.actualizado === corte.actualizado) continue;

    const respuesta = await pedir(`/api/cortes/${corte.id}/lista`);
    const contenido = Buffer.from(await respuesta.arrayBuffer());
    const nombre = nombreDelArchivo(respuesta, corte.numero);

    const destino = join(CARPETA, nombre);
    const temporal = `${destino}.parcial`;
    await writeFile(temporal, contenido);
    await rename(temporal, destino);

    estado.escritos[corte.id] = { actualizado: corte.actualizado, archivo: nombre };
    nuevos += 1;
    console.log(`· ${corte.numero} → ${nombre}${corte.urgente ? "  (urgente)" : ""}`);
  }

  if (nuevos > 0) await guardarEstado(estado);
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

  console.log(`Agente del taller · ${URL_BASE}`);
  console.log(`Dejando archivos en ${CARPETA}, cada ${CADA_SEGUNDOS}s.\n`);

  for (;;) {
    try {
      const { total, nuevos } = await unaVuelta(estado);
      if (nuevos === 0) {
        console.log(`${new Date().toLocaleTimeString("es-AR")} · ${total} en cola, nada nuevo`);
      }
    } catch (error) {
      // Un error no corta el agente: la máquina del taller se queda sin red a
      // cada rato y volver a levantarlo a mano no va a pasar.
      console.error(`${new Date().toLocaleTimeString("es-AR")} · ${error.message}`);
    }
    await new Promise((r) => setTimeout(r, CADA_SEGUNDOS * 1000));
  }
}

main();
