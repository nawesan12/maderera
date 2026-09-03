"use server";

import { z } from "zod";
import { listarCategorias, listarProductos } from "@/lib/dal/catalog";
import { listarSucursalesPublicas, listarZonasDeEnvio } from "@/lib/dal/envios";
import { entender } from "@/lib/asistente/lenguaje";

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

/* -------------------------------------------------------------------------- */
/* Preguntar con palabras propias                                             */
/* -------------------------------------------------------------------------- */

export interface RespuestaDelAsistente {
  /** Lo que dice el asistente. */
  texto: string;
  productos?: ProductoDelAsistente[];
  datos?: DatoDelAsistente[];
  /** Botones para seguir, según lo que se entendió. */
  sugerencias?: { texto: string; va: string }[];
  /** Si conviene ofrecer una calculadora, cuál. */
  calculadora?: "techos" | "placas" | "pisos" | "decks";
  /** Si la respuesta honesta es pasar a una persona. */
  aPersona?: boolean;
}

/**
 * La respuesta a algo escrito con palabras propias.
 *
 * Es lo que hace que el asistente se sienta conversación y no formulario: se
 * lee la intención con `lib/asistente/lenguaje.ts`, se busca de verdad en el
 * catálogo, y se contesta con los datos del negocio.
 *
 * **Lo que no hace es inventar.** Si no reconoce nada, busca; si la búsqueda no
 * trae nada, lo dice y ofrece una persona. Un asistente que improvisa un precio
 * o un plazo hace daño en un negocio donde eso es un compromiso.
 */
export async function preguntarAlAsistente(
  textoLibre: string,
): Promise<RespuestaDelAsistente> {
  const validado = z.string().trim().min(1).max(300).safeParse(textoLibre);

  if (!validado.success) {
    return { texto: "Contame qué necesitás y te ayudo." };
  }

  const leido = entender(validado.data);

  switch (leido.intencion) {
    case "saludo":
      return {
        texto:
          "¡Hola! Decime qué estás buscando —una placa, un machimbre, lo que sea— y te digo si lo tenemos y a cuánto.",
        sugerencias: [
          { texto: "Ver los rubros", va: "rubros" },
          { texto: "Calcular material", va: "calcular" },
        ],
      };

    case "gracias":
      return {
        texto: "De nada. Si necesitás algo más, escribime.",
        sugerencias: [{ texto: "Buscar otra cosa", va: "buscar-texto" }],
      };

    case "envios":
      return {
        texto: "Sí, entregamos en Mar del Plata y la zona. Estas son las zonas y lo que sale el flete:",
        datos: await datosDelAsistente("envios"),
      };

    case "horarios":
      return {
        texto: "Estos son los locales, con horarios y teléfono:",
        datos: await datosDelAsistente("sucursales"),
      };

    case "pagos":
      return {
        texto: "Se puede pagar así:",
        datos: await datosDelAsistente("pagos"),
      };

    case "cortes":
      return {
        texto:
          "Sí, cortamos placas a medida en el aserradero. Pasanos el despiece con las medidas en milímetros y te lo preparamos junto con el material. Si son muchas piezas conviene mandarlo por WhatsApp.",
        sugerencias: [
          { texto: "Calcular cuántas placas necesito", va: "calc-placas" },
          { texto: "Mandar el despiece", va: "persona" },
        ],
      };

    case "cuenta":
      return {
        texto:
          "Si trabajás del rubro —carpintería, construcción, arquitectura— podés pedir la cuenta profesional: lista de precios propia, cuenta corriente y descuentos por cantidad. Se pide desde el portal y lo aprobamos nosotros.",
        sugerencias: [{ texto: "Ir al portal", va: "profesionales" }],
      };

    case "calcular": {
      // Se ofrece la calculadora del rubro que nombraron, si nombraron alguno.
      const porRubro: Record<string, RespuestaDelAsistente["calculadora"]> = {
        techos: "techos",
        cubiertas: "techos",
        placas: "placas",
        pisos: "pisos",
        decks: "decks",
      };

      const cual = leido.rubro ? porRubro[leido.rubro] : undefined;

      return {
        texto: cual
          ? "Te hago la cuenta. Abrí la calculadora y cargá las medidas:"
          : "Te hago la cuenta. ¿Qué estás por hacer?",
        calculadora: cual,
        sugerencias: cual
          ? undefined
          : [
              { texto: "Un techo", va: "calc-techos" },
              { texto: "Placas para un mueble", va: "calc-placas" },
              { texto: "Un piso", va: "calc-pisos" },
              { texto: "Un deck", va: "calc-decks" },
            ],
      };
    }

    case "persona":
      return {
        texto:
          "Te paso con alguien del mostrador. Contales qué necesitás y te responden en el horario del local.",
        aPersona: true,
      };

    default: {
      /*
       * Buscar de verdad en el catálogo.
       *
       * Primero con lo que escribieron; si eso no trae nada y nombraron un
       * rubro, se muestra el rubro entero. Es lo que haría alguien del
       * mostrador: si no tiene exactamente eso, muestra lo que hay al lado.
       */
      const consulta = [leido.consulta, leido.medida.espesorMm]
        .filter(Boolean)
        .join(" ")
        .trim();

      let productos = consulta.length >= 2 ? await buscarConElAsistente(consulta) : [];
      let porRubro = false;

      if (productos.length === 0 && leido.consulta.length >= 2) {
        // Reintento sin la medida: «fenólico 18» puede no existir en 18 pero sí
        // en otros espesores, y mostrarlos es más útil que un "no hay nada".
        productos = await buscarConElAsistente(leido.consulta);
      }

      if (productos.length === 0 && leido.rubro) {
        productos = await productosDelRubro(leido.rubro);
        porRubro = productos.length > 0;
      }

      if (productos.length === 0) {
        return {
          texto:
            "No encontré nada con eso. Puede que lo tengamos con otro nombre: probá con otra palabra, o te paso con alguien del mostrador que lo va a saber al toque.",
          aPersona: true,
          sugerencias: [{ texto: "Ver los rubros", va: "rubros" }],
        };
      }

      const cantidad = leido.cantidad
        ? ` Si querés, con ${leido.cantidad.valor} ${leido.cantidad.unidad === "m2" ? "m²" : "m"} te calculo cuánto entra.`
        : "";

      return {
        texto: porRubro
          ? `Eso puntual no lo encontré, pero esto es lo que tengo en el rubro:${cantidad}`
          : `Esto es lo que tengo:${cantidad}`,
        productos,
        calculadora: leido.cantidad && leido.rubro === "pisos" ? "pisos" : undefined,
        sugerencias: [
          { texto: "Buscar otra cosa", va: "buscar-texto" },
          { texto: "Hablar con alguien", va: "persona" },
        ],
      };
    }
  }
}
