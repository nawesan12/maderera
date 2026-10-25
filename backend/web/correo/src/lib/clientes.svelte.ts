// Quién es cliente, para el avatar verde de la lista y la ficha del costado.
// Lo sabe el ERP (backend/internal/correo/cliente.go); si la casilla no es
// de staff o la base no responde, no se sabe nada y el correo anda igual.

import { api } from "./api";
import { sesion } from "./sesion.svelte";

export interface PedidoAbierto {
  id: string;
  numero: string;
  estado: string;
  total: number;
  fecha: string;
  enlace: string;
}

export interface Cheque {
  id: string;
  numero: string;
  banco?: string;
  fechaPago: string;
  importe: number;
  estado: string;
}

/** La ficha del remitente (backend/internal/correo/erp.go). */
export interface Ficha {
  id: string;
  nombre: string;
  razonSocial?: string;
  cuit?: string;
  profesional: boolean;
  estado: string;
  saldo: number;
  limiteCredito: number;
  diasCredito: number;
  cuentaBloqueada: boolean;
  motivoBloqueo?: string;
  pedidos: PedidoAbierto[];
  cheques: Cheque[];
  ultimoPresupuesto?: { id: string; numero: string; estado: string; total: number; fecha: string; validoHasta?: string; enlace: string };
  /** Lo que conviene saber antes de contestar (remito sin firmar, pedido listo…). */
  avisos: { texto: string; familia: string; enlace?: string }[];
  enlaces: { ficha: string; presupuesto: string; pedido: string; pedidos: string; cheques: string };
}

class Clientes {
  #tipos = $state<Record<string, "cliente" | "proveedor">>({});
  #pedidos = new Set<string>();
  #fichas = new Map<string, Promise<Ficha | null>>();

  tipo(correo?: string): "cliente" | "proveedor" | "" {
    return (correo && this.#tipos[correo.toLowerCase()]) || "";
  }

  /** Pregunta de una vez por los remitentes que todavía no se conocen. */
  async conocer(correos: (string | undefined)[]) {
    if (!sesion.fichas) return;
    const nuevos = [...new Set(correos.filter((c): c is string => !!c).map((c) => c.toLowerCase()))].filter(
      (c) => !this.#pedidos.has(c),
    );
    if (!nuevos.length) return;
    for (const c of nuevos) this.#pedidos.add(c);
    try {
      const son = await api.remitentes(nuevos);
      const t = { ...this.#tipos };
      for (const c of son.proveedores) t[c] = "proveedor";
      for (const c of son.clientes) t[c] = "cliente";
      this.#tipos = t;
    } catch {
      for (const c of nuevos) this.#pedidos.delete(c);
    }
  }

  /** La ficha del remitente, o null si no es cliente. Una vez por sesión. */
  ficha(correo: string): Promise<Ficha | null> {
    const c = correo.toLowerCase();
    if (!sesion.fichas || !c) return Promise.resolve(null);
    let p = this.#fichas.get(c);
    if (!p) {
      p = api.cliente(c).catch(() => {
        this.#fichas.delete(c);
        return null;
      });
      this.#fichas.set(c, p);
    }
    return p;
  }
}

export const clientes = new Clientes();
