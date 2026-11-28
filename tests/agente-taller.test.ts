import { createServer, type Server } from "node:http";
import { mkdtemp, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * El agente del taller contra una plataforma de mentira (mes simulado,
 * M2S1-014, M2S1-146 y M3S1-015): en la carpeta queda solo lo que está en
 * cola o en la máquina, un corte que no cambió no se reescribe y la sucursal
 * viaja en la consulta.
 */

type Corte = { id: string; numero: string; actualizado: string; contenido: string };

let cola: Corte[] = [];
let enLaMaquina: { id: string; numero: string; actualizado?: string; contenido?: string }[] = [];
/** Los que ya no están en la cola ni en la máquina: la lista igual se baja. */
let historico: { id: string; numero: string }[] = [];
const consultas: string[] = [];
let servidor: Server;
let carpeta: string;
let unaVuelta: (estado: { escritos: Record<string, unknown> }) => Promise<{ total: number; nuevos: number }>;

beforeAll(async () => {
  servidor = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/api/cortes/pendientes") {
      consultas.push(url.search);
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          cortes: cola.map(({ contenido: _c, ...r }) => ({ ...r, piezas: 1 })),
          enLaMaquina: enLaMaquina.map(({ contenido: _c, ...r }) => (r.actualizado ? { ...r, piezas: 1 } : r)),
        }),
      );
      return;
    }
    const m = url.pathname.match(/^\/api\/cortes\/([^/]+)\/lista$/);
    const c = m && [...cola, ...[...enLaMaquina, ...historico].map((x) => ({ contenido: "", actualizado: "", ...x }))].find((x) => x.id === m[1]);
    if (!c) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader("content-disposition", `attachment; filename="${c.numero}.csv"`);
    res.end(c.contenido);
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  const { port } = servidor.address() as { port: number };
  carpeta = await mkdtemp(join(tmpdir(), "agente-"));
  process.env.MJBJ_URL = `http://127.0.0.1:${port}`;
  process.env.MJBJ_TOKEN = "x".repeat(20);
  process.env.MJBJ_CARPETA = carpeta;
  process.env.MJBJ_SUCURSAL = "Aserradero";
  process.env.MJBJ_SIN_ESTADO = "1";
  ({ unaVuelta } = await import("../agente-taller/agente.mjs"));
});

afterAll(() => servidor.close());

describe("agente del taller", () => {
  it("saca de la carpeta lo que salió de la cola y no reescribe lo que no cambió", async () => {
    const estado = { escritos: {} };
    cola = [
      { id: "a", numero: "CRT-6", actualizado: "1", contenido: "800;350;3" },
      { id: "b", numero: "CRT-7", actualizado: "1", contenido: "500;300;2" },
    ];
    expect((await unaVuelta(estado)).nuevos).toBe(2);
    expect(consultas.at(-1)).toBe("?sucursal=Aserradero");

    // Empezar y deshacer: cambia la fecha, no el contenido.
    const antes = (await stat(join(carpeta, "CRT-7.csv"))).mtimeMs;
    cola[1] = { ...cola[1], actualizado: "2" };
    expect((await unaVuelta(estado)).nuevos).toBe(0);
    expect((await stat(join(carpeta, "CRT-7.csv"))).mtimeMs).toBe(antes);

    // CRT-6 se corrige en CRT-8; CRT-7 entra a la máquina.
    cola = [{ id: "c", numero: "CRT-8", actualizado: "3", contenido: "780;350;3" }];
    enLaMaquina = [{ id: "b", numero: "CRT-7" }];
    await unaVuelta(estado);
    expect((await readdir(carpeta)).filter((n) => n.endsWith(".csv")).sort()).toEqual(["CRT-7.csv", "CRT-8.csv"]);
    expect(await readdir(join(carpeta, "fuera-de-cola"))).toEqual(["CRT-6.csv"]);

    // Todo terminado: la carpeta queda vacía.
    cola = [];
    enLaMaquina = [];
    await unaVuelta(estado);
    expect((await readdir(carpeta)).filter((n) => n.endsWith(".csv"))).toEqual([]);
  });

  it("escribe el que se empezó entre dos vueltas, sin haber pasado por la cola", async () => {
    const estado = { escritos: {} };
    cola = [];
    enLaMaquina = [{ id: "d", numero: "CRT-23", actualizado: "1", contenido: "650;420;2" }];
    expect((await unaVuelta(estado)).nuevos).toBe(1);
    expect((await readdir(carpeta)).filter((n) => n.endsWith(".csv"))).toEqual(["CRT-23.csv"]);
    // La vuelta siguiente no lo reescribe.
    expect((await unaVuelta(estado)).nuevos).toBe(0);
    enLaMaquina = [];
    await unaVuelta(estado);
  });

  it("también saca los que anotó un agente de antes, sin el nombre del archivo (M2S4-004)", async () => {
    await writeFile(join(carpeta, "CRT-28.csv"), "1200;700;1");
    historico = [{ id: "viejo", numero: "CRT-28" }];
    cola = [];
    enLaMaquina = [];
    const estado = { escritos: { viejo: "2026-11-20T10:00:00Z" } as Record<string, unknown> };
    await unaVuelta(estado);
    expect((await readdir(carpeta)).filter((n) => n.endsWith(".csv"))).toEqual([]);
    expect(await readdir(join(carpeta, "fuera-de-cola"))).toContain("CRT-28.csv");
    expect(estado.escritos).toEqual({});
  });
});
