import "server-only";

import { EventEmitter } from "node:events";
import { Client } from "pg";
import { usaSsl } from "@/lib/db";
import { esEventoEnVivo, type EventoEnVivo } from "./canales";

/**
 * La única conexión que escucha `LISTEN mjbj_vivo` (ver `drizzle/0074_vivo.sql`).
 *
 * **Una sola por proceso**, aparte del pool: `LISTEN` ata la conexión para
 * siempre, y si cada pantalla abierta tuviera la suya, veinte pestañas del
 * panel serían veinte conexiones menos para atender pedidos. Esta recibe todo
 * y lo reparte en memoria a las rutas SSE abiertas.
 *
 * Solo tiene sentido con un proceso que vive: en Vercel cada función nace y
 * muere, y una conexión escuchando la mantendría despierta (y cobrando). Por
 * eso se enciende con `PLATAFORMA=vps`, y en desarrollo para poder probarla.
 */
export function tiempoRealDisponible(): boolean {
  return process.env.PLATAFORMA === "vps" || process.env.NODE_ENV === "development";
}

const global = globalThis as unknown as { escuchaEnVivo?: Escucha };

class Escucha extends EventEmitter {
  private cliente: Client | null = null;
  private conectando: Promise<void> | null = null;
  private espera = 1_000;

  constructor() {
    super();
    // Cada pestaña abierta es un oyente: el aviso de «posible fuga» de Node
    // a los diez no aplica.
    this.setMaxListeners(0);
  }

  asegurar(): Promise<void> {
    if (this.cliente) return Promise.resolve();
    this.conectando ??= this.conectar().finally(() => {
      this.conectando = null;
    });
    return this.conectando;
  }

  private async conectar(): Promise<void> {
    const url = process.env.DATABASE_URL!;
    const cliente = new Client({
      connectionString: url,
      ssl: usaSsl(url) ? { rejectUnauthorized: true } : false,
      // Que la conexión no muera callada detrás de un NAT: si se corta, el
      // `error` llega y se reconecta.
      keepAlive: true,
    });

    cliente.on("notification", (mensaje) => {
      if (!mensaje.payload) return;
      try {
        const evento: unknown = JSON.parse(mensaje.payload);
        if (esEventoEnVivo(evento)) this.emit("evento", evento);
      } catch {
        // Un aviso que no se entiende no tira la conexión.
      }
    });

    const caida = (error?: Error) => {
      if (this.cliente !== cliente) return;
      this.cliente = null;
      console.error(
        JSON.stringify({ scope: "vivo", evento: "conexion_caida", detalle: error?.message }),
      );
      void cliente.end().catch(() => {});
      // Avisa a los oyentes: las pantallas conviene que se refresquen una
      // vez al volver, por si algo pasó mientras no se escuchaba.
      this.emit("reconexion");
      this.reintentar();
    };
    cliente.on("error", caida);
    cliente.on("end", () => caida());

    try {
      await cliente.connect();
      await cliente.query("LISTEN mjbj_vivo");
      this.cliente = cliente;
      this.espera = 1_000;
    } catch (error) {
      void cliente.end().catch(() => {});
      this.reintentar();
      throw error;
    }
  }

  private reintentar() {
    // Solo si alguien está escuchando: sin pantallas abiertas no hace falta.
    if (this.listenerCount("evento") === 0) return;
    const espera = this.espera;
    this.espera = Math.min(this.espera * 2, 30_000);
    setTimeout(() => void this.asegurar().catch(() => {}), espera).unref();
  }
}

export function escuchaEnVivo(): Escucha {
  global.escuchaEnVivo ??= new Escucha();
  return global.escuchaEnVivo;
}

export type { EventoEnVivo };
