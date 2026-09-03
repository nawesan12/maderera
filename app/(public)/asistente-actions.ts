"use server";

import { z } from "zod";
import { listarCategorias, listarProductos } from "@/lib/dal/catalog";
import { listarSucursalesPublicas, listarZonasDeEnvio } from "@/lib/dal/envios";

/**
 * Lo que el asistente del sitio le pide al servidor.
 *
 * **Los productos y los precios salen del catálogo real, por acá y no desde un
 * JSON precomputado.** El precio depende de la lista de quien está mirando
 * —ver `lib/dal/precios-sesion.ts`— y servir un precio de profesional a
 * cualquiera sería el peor error posible de este módulo. `listarProductos` ya
 * resuelve la lista en tiempo de pedido y cachea con ella en la clave, así que
 * el asistente hereda esa garantía en vez de inventar otra.
 */

export interface ProductoDelAsistente {
  slug: string;
  nombre: string;
  categoria: string;
  medida: string | null;
  precioDesde: string | null;
  imagen: string | null;
  hayStock: boolean;
}

function aProducto(p: Awaited<ReturnType<typeof listarProductos>>[number]) {
  return {
    slug: p.slug,
    nombre: p.name,
    categoria: p.categoryName,
    medida: p.labels[0] ?? null,
    precioDesde: p.precioDesde,
    imagen: p.image,
    hayStock: p.hayStock,
  };
}

/** Hasta cuántos productos muestra el panel de una vez. */
const TOPE = 6;

export async function buscarConElAsistente(
  texto: string,
): Promise<ProductoDelAsistente[]> {
  const consulta = z.string().trim().min(2).max(80).safeParse(texto);
  if (!consulta.success) return [];

  const encontrados = await listarProductos({ busqueda: consulta.data });
  return encontrados.slice(0, TOPE).map(aProducto);
}

export async function productosDelRubro(
  slug: string,
): Promise<ProductoDelAsistente[]> {
  const categoria = z.string().trim().max(80).safeParse(slug);
  if (!categoria.success) return [];

  const encontrados = await listarProductos({ categoria: categoria.data });
  return encontrados.slice(0, TOPE).map(aProducto);
}

export interface RubroDelAsistente {
  slug: string;
  nombre: string;
  cantidad: number;
}

/** Los rubros con lo que hay cargado en cada uno. */
export async function rubrosDelAsistente(): Promise<RubroDelAsistente[]> {
  const categorias = await listarCategorias();

  return categorias
    .filter((c) => c.productCount > 0)
    .map((c) => ({ slug: c.slug, nombre: c.name, cantidad: c.productCount }));
}

/**
 * Los datos que el asistente contesta de memoria pero que no están escritos en
 * el guion: horarios, zonas de envío, formas de pago.
 *
 * Salen de las mismas tablas que el resto del sitio, así que corregir un
 * horario en el panel también corrige lo que contesta el asistente. Un guion
 * con el horario escrito adentro es un horario que algún día va a estar mal.
 */
export interface DatoDelAsistente {
  titulo: string;
  detalle: string;
}

export async function datosDelAsistente(
  cual: "sucursales" | "envios" | "pagos",
): Promise<DatoDelAsistente[]> {
  if (cual === "sucursales") {
    const sucursales = await listarSucursalesPublicas();

    return sucursales.map((s) => ({
      titulo: s.nombre,
      detalle: [s.direccion, s.horario, s.telefono]
        .filter(Boolean)
        .join(" · "),
    }));
  }

  if (cual === "envios") {
    const zonas = await listarZonasDeEnvio();

    return zonas.map((z) => ({
      titulo: z.nombre,
      detalle: [
        z.costo > 0 ? `Flete ${moneda(z.costo)}` : "Sin cargo",
        z.envioGratisDesde > 0
          ? `sin cargo desde ${moneda(z.envioGratisDesde)}`
          : null,
        z.demoraEstimada,
      ]
        .filter(Boolean)
        .join(" · "),
    }));
  }

  /*
   * Las formas de pago están escritas acá y en el checkout, y eso es una copia
   * que conviene tener presente: si se agrega un medio, hay que tocar los dos
   * lugares. Se deja así porque llevarlas a la base para tres renglones que
   * cambian una vez por año sería más máquina que problema.
   */
  return [
    { titulo: "Efectivo", detalle: "Al retirar o contra entrega" },
    { titulo: "Transferencia", detalle: "Te pasamos los datos al confirmar" },
    { titulo: "Tarjeta", detalle: "Débito y crédito, en el mostrador y online" },
    {
      titulo: "Cuenta corriente",
      detalle: "Para clientes profesionales aprobados",
    },
  ];
}

function moneda(valor: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(valor);
}
