"use server";

import { z } from "zod";
import {
  listarCategorias,
  listarProductos,
  obtenerProductoPublico,
  preciosPropiosPorVariante,
} from "@/lib/dal/catalog";
import { listarSucursalesPublicas, listarZonasDeEnvio } from "@/lib/dal/envios";
import { promosVigentes, tienda } from "@/lib/dal/contenido";
import { apiPublica, datos as cuerpo } from "@/lib/api/servidor";
import { responderLocal, type Entendido } from "@/lib/asistente/respuestas";

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
  /** El slug de la categoría: sin foto, decide el tono de la muestra de placa. */
  categoriaSlug: string;
  medida: string | null;
  /** Todas las medidas del producto, para poder filtrar por espesor. */
  medidas: string[];
  precioDesde: string | null;
  imagen: string | null;
  hayStock: boolean;
}

function aProducto(p: Awaited<ReturnType<typeof listarProductos>>[number]) {
  return {
    slug: p.slug,
    nombre: p.name,
    categoria: p.categoryName,
    categoriaSlug: p.categorySlug,
    medida: p.labels[0] ?? null,
    medidas: p.labels,
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

  // El tope lo aplica Go antes de buscar las fotos: «pino» son cientos.
  const encontrados = await listarProductos({ busqueda: consulta.data, limite: TOPE });
  return encontrados.map(aProducto);
}

export async function productosDelRubro(
  slug: string,
): Promise<ProductoDelAsistente[]> {
  const categoria = z.string().trim().max(80).safeParse(slug);
  if (!categoria.success) return [];

  const encontrados = await listarProductos({ categoria: categoria.data, limite: TOPE });
  return encontrados.map(aProducto);
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
  cual: "sucursales" | "envios" | "pagos" | "promociones",
): Promise<DatoDelAsistente[]> {
  if (cual === "promociones") {
    // Las de la portada (cuotas, bancos): a «¿puedo pagar con cuotas?» el
    // asistente no las mencionaba (mes simulado, M2S1-200).
    const promos = await promosVigentes();
    return promos.map((p) => ({
      titulo: p.medio ? `${p.titulo} · ${p.medio}` : p.titulo,
      detalle: [p.detalle, p.dias, p.vigenciaHasta ? `hasta ${p.vigenciaHasta}` : null].filter(Boolean).join(" · "),
    }));
  }

  if (cual === "sucursales") {
    const sucursales = await listarSucursalesPublicas();

    return sucursales.map((s) => ({
      titulo: s.nombre,
      detalle: [s.direccion, s.horario, s.telefono].filter(Boolean).join(" · "),
    }));
  }

  if (cual === "envios") {
    const zonas = await listarZonasDeEnvio();

    return zonas.map((z) => ({
      titulo: z.nombre,
      // La zona que se cotiza caso por caso no es «Sin cargo»: así se le
      // prometía flete gratis a 170 km (mes simulado, M2S1-104).
      detalle: [
        z.aCotizar ? "A cotizar" : z.costo > 0 ? `Flete ${moneda(z.costo)}` : "Sin cargo",
        !z.aCotizar && z.envioGratisDesde > 0
          ? `sin cargo desde ${moneda(z.envioGratisDesde)}`
          : null,
        z.demoraEstimada,
      ]
        .filter(Boolean)
        .join(" · "),
    }));
  }

  /*
   * Las formas de pago están escritas acá y en el carrito, y eso es una copia
   * que conviene tener presente: si se agrega un medio, hay que tocar los dos
   * lugares. Se deja así porque llevarlas a la base para tres renglones que
   * cambian una vez por año sería más máquina que problema.
   */
  // «Online» solo con la tienda prendida (M2S1-200).
  const { activa } = await tienda();
  return [
    { titulo: "Efectivo", detalle: "Al retirar o contra entrega" },
    { titulo: "Transferencia", detalle: "Te pasamos los datos al confirmar" },
    {
      titulo: "Tarjeta",
      detalle: activa ? "Débito y crédito, en el mostrador y online" : "Débito y crédito, en el mostrador",
    },
    {
      titulo: "Cuenta corriente",
      detalle: "Para clientes profesionales aprobados",
    },
  ];
}

/**
 * El precio de la medida que muestra la tarjeta. El listado trae el «desde»
 * del producto, que es el de la medida más barata: la Melamina de 18 mm salía
 * con el precio de la de 15 (mes simulado, M2S3-009). Con la tienda apagada
 * el listado no trae precio, y la medida tampoco.
 */
async function precioDeLaMedida(
  p: ProductoDelAsistente,
  medida: string | null,
  propios: Record<string, string>,
): Promise<string | null> {
  if (!p.precioDesde || !medida || p.medidas.length < 2) return p.precioDesde;
  const ficha = await obtenerProductoPublico(p.slug);
  const variante = ficha?.variantes.find((v) => v.label === medida);
  if (!variante) return p.precioDesde;
  return propios[variante.id] ?? variante.precio ?? p.precioDesde;
}

function moneda(valor: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(valor);
}

/* -------------------------------------------------------------------------- */
/* Lo que se trae una sola vez al abrir                                        */
/* -------------------------------------------------------------------------- */

export interface EquipajeDelAsistente {
  rubros: RubroDelAsistente[];
  sucursales: DatoDelAsistente[];
  envios: DatoDelAsistente[];
  pagos: DatoDelAsistente[];
  promociones: DatoDelAsistente[];
}

/**
 * Todo lo que el asistente puede contestar sin volver a preguntar.
 *
 * Es una sola llamada, y solo cuando alguien **abre** el panel: quien nunca lo
 * toca no cuesta nada. Con esto adentro, las preguntas que no dependen de quién
 * mira —horarios, zonas de envío, formas de pago, rubros— se contestan en el
 * navegador, sin volver al servidor.
 *
 * Lo que sí vuelve siempre es la búsqueda de productos, y no por descuido: el
 * precio depende de la lista de quien está mirando, así que un catálogo
 * precargado en el navegador sería justamente la forma de servirle a cualquiera
 * el precio de un profesional.
 */
export async function equipajeDelAsistente(): Promise<EquipajeDelAsistente> {
  const [rubros, sucursales, envios, pagos, promociones] = await Promise.all([
    rubrosDelAsistente(),
    datosDelAsistente("sucursales"),
    datosDelAsistente("envios"),
    datosDelAsistente("pagos"),
    datosDelAsistente("promociones"),
  ]);

  return { rubros, sucursales, envios, pagos, promociones };
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
  /** Si la respuesta honesta es pasar a una persona. */
  aPersona?: boolean;
  /** Un botón que lleva a una pantalla: el cortador con el despiece cargado. */
  enlace?: { texto: string; href: string };
  /** Lo que se entendió completado con lo anterior: es la próxima «anterior». */
  consulta?: string;
}

/**
 * La respuesta a algo escrito con palabras propias.
 *
 * Lo que se entendió lo dice el motor de Go (`POST /api/v1/asistente/entender`,
 * internal/asistente): el mismo que contesta el WhatsApp, así el sitio y el
 * bot entienden igual. Lo que es igual para cualquiera se contesta con el
 * equipaje; lo demás se busca de verdad en el catálogo.
 *
 * **Lo que no hace es inventar.** Si no reconoce nada, busca; si la búsqueda no
 * trae nada, lo dice y ofrece una persona.
 */
export async function preguntarAlAsistente(
  textoLibre: string,
  anterior?: string | null,
): Promise<RespuestaDelAsistente> {
  const validado = z.string().trim().min(1).max(300).safeParse(textoLibre);

  if (!validado.success) {
    return { texto: "Contame qué necesitás y te ayudo." };
  }

  const leido: Entendido = cuerpo(
    await apiPublica.POST("/api/v1/asistente/entender", {
      body: {
        texto: validado.data,
        ...(anterior ? { anterior: anterior.slice(0, 120) } : {}),
      },
    }),
  );

  const local = responderLocal(leido, await equipajeDelAsistente());
  if (local) return { ...local, consulta: leido.texto };

  let productos =
    leido.consulta.length >= 2
      ? await buscarConElAsistente(leido.consulta)
      : [];

  let porRubro = false;
  const espesor = leido.medida.espesorMm;

  if (espesor && productos.length > 0) {
    const conEsaMedida = productos.filter((p) =>
      p.medidas.some((m) => new RegExp(`\\b${espesor}\\s*mm`, "i").test(m)),
    );

    // Si ninguno la tiene, se muestran igual los del producto: decirle "no
    // hay" a quien preguntó por un fenólico, teniendo fenólicos en otros
    // espesores, es perder una venta que el mostrador no perdería.
    // Y la tarjeta muestra la medida que pidieron, no la primera del producto.
    if (conEsaMedida.length > 0) {
      const propios = await preciosPropiosPorVariante();
      productos = await Promise.all(
        conEsaMedida.map(async (p) => {
          const medida =
            p.medidas.find((m) => new RegExp(`\\b${espesor}\\s*mm`, "i").test(m)) ?? p.medida;
          return { ...p, medida, precioDesde: await precioDeLaMedida(p, medida, propios) };
        }),
      );
    }
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

  // Lo que se buscó y se encontró no se dice «no lo encontré» (M2S1-199):
  // si alguno de los del rubro coincide con lo escrito, la respuesta es
  // la de una búsqueda, con los que coinciden primero y sin los demás.
  if (porRubro) {
    const comunes = new Set(["necesito", "para", "quiero", "tengo", "busco", "hacer", "como", "tienen", "hay"]);
    const palabras = `${leido.consulta} ${leido.texto}`
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !comunes.has(w));
    const coinciden = productos.filter((p) => {
      const nombre = p.nombre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      return palabras.some((w) => nombre.includes(w.replace(/s$/, "")));
    });
    if (coinciden.length > 0) {
      productos = coinciden;
      porRubro = false;
    }
  }

  const cantidad = leido.cantidad
    ? ` Si querés, con ${leido.cantidad.valor} ${leido.cantidad.unidad === "m2" ? "m²" : "m"} te calculo cuánto entra.`
    : "";

  return {
    texto: porRubro
      ? `Eso puntual no lo encontré, pero esto es lo que tengo en el rubro:${cantidad}`
      : `Esto es lo que tengo:${cantidad}`,
    productos,
    consulta: leido.texto,
    sugerencias: [
      { texto: "Buscar otra cosa", va: "buscar-texto" },
      { texto: "Hablar con alguien", va: "persona" },
    ],
  };
}
