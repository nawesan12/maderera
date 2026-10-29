/**
 * El cliente del benchmark de la tanda 13: importa cada archivo de
 * bench/tanda13/archivos de punta a punta, como la pantalla —analizar,
 * vista previa, abrir la corrida, los lotes de a 200 uno detrás del otro y
 * cerrar—, dos veces (la segunda es repetir: nada nuevo, todo se actualiza
 * u omite). Mide el tiempo de cada paso y de cada lote, y la memoria y la
 * CPU del servidor.
 *
 *   npx tsx bench/tanda13/medir.ts <go|ts> <url> <pid> [cookie]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [lado, url, pid, cookie = ""] = process.argv.slice(2);
const dir = new URL(".", import.meta.url).pathname;
const archivos = join(dir, "archivos");
const ENTIDAD: Record<string, string> = {
  "1-clientes.csv": "clientes",
  "2-productos.csv": "productos",
  "3-stock.csv": "stock",
  "4-saldos.csv": "saldos",
  "5-proveedores.csv": "proveedores",
  "6-ventas.csv": "ventas_historicas",
  "7-comprobantes.csv": "comprobantes_historicos",
};

const recursos: { rss: number; cpu: number }[] = [];
const muestreo = setInterval(() => {
  try {
    const [rss, cpu] = execFileSync("ps", ["-o", "rss=,%cpu=", "-p", pid]).toString().trim().split(/\s+/).map(Number);
    recursos.push({ rss, cpu });
  } catch {
    /* el proceso terminó */
  }
}, 250);

const cabeceras = (json: boolean) => ({ ...(cookie ? { cookie } : {}), ...(json ? { "content-type": "application/json" } : {}) });

async function post<T>(ruta: string, cuerpo: unknown): Promise<{ v: T; ms: number }> {
  const t0 = performance.now();
  const r = await fetch(url + ruta, {
    method: "POST",
    headers: cabeceras(!(cuerpo instanceof FormData)),
    body: cuerpo instanceof FormData ? cuerpo : JSON.stringify(cuerpo),
  });
  const texto = await r.text();
  const ms = performance.now() - t0;
  if (!r.ok) throw new Error(`${ruta}: ${r.status} ${texto.slice(0, 300)}`);
  return { v: JSON.parse(texto) as T, ms };
}

const pct = (xs: number[], p: number) => {
  const o = [...xs].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.floor((p / 100) * o.length))] ?? 0;
};

interface Medida {
  pasada: number;
  archivo: string;
  filas: number;
  analizar: number;
  previa: number;
  lotes: number[];
  cerrar: number;
  total: number;
  creados: number;
  actualizados: number;
  omitidos: number;
  conError: number;
}

async function importar(nombre: string, pasada: number): Promise<Medida> {
  const entidad = ENTIDAD[nombre];
  const t0 = performance.now();
  const formulario = new FormData();
  formulario.set("entidad", entidad);
  formulario.set("archivo", new Blob([readFileSync(join(archivos, nombre))], { type: "text/csv" }), nombre);
  const a = await post<{ error?: string; archivo: string; filas: string[][]; codificacion: string; mapeo: Record<string, number> }>(
    "/api/v1/admin/migracion/analizar",
    formulario,
  );
  if (a.v.error) throw new Error(`${nombre}: ${a.v.error}`);
  const { filas, mapeo } = a.v;
  const previa = await post<{ error?: string }>("/api/v1/admin/migracion/previa", { entidad, mapeo, filas });
  const corrida = await post<{ runId: string }>("/api/v1/admin/migracion/corridas", {
    entidad,
    archivo: a.v.archivo,
    codificacion: a.v.codificacion,
    mapeo,
    filasTotales: filas.length,
  });
  const m: Medida = {
    pasada, archivo: nombre, filas: filas.length, analizar: a.ms, previa: previa.ms, lotes: [], cerrar: 0, total: 0,
    creados: 0, actualizados: 0, omitidos: 0, conError: 0,
  };
  for (let desde = 0; desde < filas.length; desde += 200) {
    const l = await post<{ error?: string; creados: number; actualizados: number; omitidos: number; conError: number }>(
      `/api/v1/admin/migracion/corridas/${corrida.v.runId}/lote`,
      { entidad, mapeo, filas: filas.slice(desde, desde + 200) },
    );
    if (l.v.error) throw new Error(`${nombre}: ${l.v.error}`);
    m.lotes.push(l.ms);
    m.creados += l.v.creados;
    m.actualizados += l.v.actualizados;
    m.omitidos += l.v.omitidos;
    m.conError += l.v.conError;
  }
  m.cerrar = (await post(`/api/v1/admin/migracion/corridas/${corrida.v.runId}/cerrar`, { entidad, mapeo, filas })).ms;
  m.total = performance.now() - t0;
  return m;
}

async function main() {
  const medidas: Medida[] = [];
  for (const pasada of [1, 2]) {
    for (const nombre of readdirSync(archivos).filter((n) => n in ENTIDAD).sort()) {
      const m = await importar(nombre, pasada);
      medidas.push(m);
      console.log(
        `${lado} pasada ${pasada} ${nombre.padEnd(20)} ${String(m.filas).padStart(6)} filas  total ${(m.total / 1000).toFixed(2).padStart(7)} s  ` +
          `${Math.round(m.filas / (m.total / 1000)).toString().padStart(6)} filas/s  lote p50 ${pct(m.lotes, 50).toFixed(0)} ms  ` +
          `p95 ${pct(m.lotes, 95).toFixed(0)} ms  p99 ${pct(m.lotes, 99).toFixed(0)} ms  analizar ${m.analizar.toFixed(0)} ms  ` +
          `previa ${m.previa.toFixed(0)} ms  cerrar ${m.cerrar.toFixed(0)} ms  (${m.creados}/${m.actualizados}/${m.omitidos}/${m.conError})`,
      );
    }
  }
  clearInterval(muestreo);
  const rss = Math.max(...recursos.map((r) => r.rss)) / 1024;
  const cpu = recursos.reduce((s, r) => s + r.cpu, 0) / Math.max(1, recursos.length);
  console.log(`${lado} memoria máx. ${rss.toFixed(0)} MB, CPU media ${cpu.toFixed(0)} %`);
  mkdirSync(join(dir, "resultados"), { recursive: true });
  writeFileSync(join(dir, "resultados", `${lado}.json`), JSON.stringify({ medidas, memoriaMaxMB: rss, cpuMedia: cpu }, null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
