import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Factory, Ruler, Truck } from "lucide-react";
import { EncabezadoPublico } from "@/components/encabezado-publico";
import { ProductCard } from "@/components/product-card";
import { DatosEstructurados } from "@/components/datos-estructurados";
import { migasJsonLd } from "@/lib/seo";
import { paginaDeProductos } from "@/lib/dal/catalog";
import { vistaDePrecio } from "@/lib/dal/precios-sesion";
import { enlaceWhatsapp, numeroWhatsapp } from "@/lib/whatsapp/enlace";
import { ALCANCE_MOLDAVA } from "@/lib/empresa";

/**
 * Moldava, la línea propia.
 *
 * El cliente contestó "Sección destacada propia" a cómo debe presentarse en el
 * sitio. Hasta ahora Moldava era un valor de `products.brand` y tres párrafos
 * sueltos repartidos entre la portada y "Quiénes somos": no había una dirección
 * que se pudiera pasar a un mayorista.
 *
 * El relato del proceso sale textual del brief. No es decoración: **es el
 * argumento de venta**, porque explica por qué una moldura sin nudos y de largo
 * uniforme cuesta lo que cuesta.
 */

export const metadata: Metadata = {
  title: "Moldava — molduras y listonería en pino finger joint",
  description: `Línea propia de Maderera Juan B. Justo: molduras y listonería en pino finger joint, sin nudos, en piezas uniformes de 3,05 m. Venta a consumidor final y mayorista en ${ALCANCE_MOLDAVA}.`,
  keywords: [
    "moldava",
    "molduras pino finger joint",
    "listoneria pino sin nudos",
    "molduras mayorista buenos aires",
    "zocalos pino finger",
  ],
  alternates: { canonical: "/moldava" },
  openGraph: {
    title: "Moldava — molduras y listonería en pino finger joint",
    description: `Producción propia. Piezas uniformes de 3,05 m, sin nudos. Entrega en puerta en ${ALCANCE_MOLDAVA}.`,
  },
};

const PROCESO = [
  {
    icono: Factory,
    titulo: "Producción propia",
    detalle:
      "Moldava nació dentro del proceso productivo de la maderera: la línea completa de molduras y listonería se elabora en nuestra planta.",
  },
  {
    icono: Ruler,
    titulo: "Sistema Finger Joint",
    detalle:
      "El dentado y pegado elimina las imperfecciones de la madera y la vuelve a ensamblar. El resultado es pino sin nudos, en piezas uniformes de 3,05 m de largo estándar.",
  },
  {
    icono: Truck,
    titulo: "Mayorista con entrega en puerta",
    detalle: `Se comercializa a consumidor final y a clientes mayoristas de ${ALCANCE_MOLDAVA}, con coordinación de envíos y entregas.`,
  },
];

export default async function MoldavaPage() {
  const [{ productos }, whatsapp, numero, vista] = await Promise.all([
    paginaDeProductos({ marca: "Moldava", orden: "relevancia" }),
    enlaceWhatsapp(
      "Hola! Quería consultar por la línea Moldava y precios mayoristas.",
    ),
    numeroWhatsapp(),
    vistaDePrecio(),
  ]);

  return (
    <div className="min-h-screen">
      <DatosEstructurados
        datos={migasJsonLd([
          { nombre: "Inicio", ruta: "/" },
          { nombre: "Moldava", ruta: "/moldava" },
        ])}
      />

      <EncabezadoPublico
        titulo="Moldava"
        bajada="Nuestra línea propia de molduras y listonería en pino finger joint."
      />

      <div className="contenedor space-y-14 py-12">
        {/* El acceso mayorista, arriba de todo.

            Estaba al final de la página, en un bloque discreto: quien viene a
            Moldava buscando precio por volumen es justo el visitante que la
            clienta quiere captar, y le hacía falta bajar la página entera para
            encontrar cómo. */}
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-[14px] border border-linea bg-card p-6">
          <div>
            <h2 className="text-lg font-bold">¿Comprás por volumen?</h2>
            <p className="mt-1 text-[15px] text-texto-2">
              Entrega en puerta en {ALCANCE_MOLDAVA}, con precio mayorista.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/profesionales"
              className="inline-flex h-11 items-center rounded-[10px] bg-accion px-5 font-semibold text-white transition-colors hover:bg-accion-hover"
            >
              Pedir cuenta mayorista
            </Link>
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center rounded-[10px] border border-linea bg-card px-5 font-semibold transition-colors hover:bg-muted"
            >
              Consultar por WhatsApp
            </a>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          {PROCESO.map((paso) => (
            <article
              key={paso.titulo}
              className="rounded-[14px] border border-linea bg-card p-6"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-[11px] bg-naranja-claro text-acento-texto">
                <paso.icono className="h-5 w-5" />
              </span>
              <h2 className="mt-4 text-lg font-bold">{paso.titulo}</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-texto-2">
                {paso.detalle}
              </p>
            </article>
          ))}
        </section>

        <section>
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold">La línea</h2>
              <p className="mt-0.5 text-[15px] text-texto-2">
                {productos.length > 0
                  ? "Zócalos, marcos, cornisas y listonería, con stock por sucursal."
                  : "Estamos cargando el catálogo de la línea. Mientras tanto, consultanos por WhatsApp."}
              </p>
            </div>
            <Link
              href="/catalogo?cat=molduras"
              className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-acento-texto"
            >
              Ver todas las molduras
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {productos.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {productos.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  whatsapp={numero}
                  vista={vista}
                />
              ))}
            </div>
          )}
        </section>

        <section className="rounded-[14px] border border-linea bg-chip p-8 text-center">
          <h2 className="text-xl font-bold">Armamos tu cotización</h2>
          <p className="mx-auto mt-2 max-w-xl text-[15px] leading-relaxed text-texto-2">
            La línea completa se entrega en puerta en {ALCANCE_MOLDAVA}, con
            coordinación de envíos. Escribinos y la armamos con tu lista de
            precios.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center rounded-[10px] bg-accion px-5 font-semibold text-white transition-colors hover:bg-accion-hover"
            >
              Consultar por WhatsApp
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
