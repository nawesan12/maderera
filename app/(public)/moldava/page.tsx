import Image from "next/image";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Factory, Ruler, Truck } from "lucide-react";
import { EncabezadoPublico } from "@/components/encabezado-publico";
import { ProductCard } from "@/components/product-card";
import { DatosEstructurados } from "@/components/datos-estructurados";
import { migasJsonLd, metadatosDePagina } from "@/lib/seo";
import { listarProductosPublicos, POR_PAGINA } from "@/lib/dal/catalog";
import { enlaceWhatsapp, numeroWhatsapp } from "@/lib/whatsapp/enlace";
import { ALCANCE_MOLDAVA } from "@/lib/empresa";
import { BotonWhatsapp } from "@/components/whatsapp/boton";
import moldavaEstanteria from "@/lib/sitio/moldava-estanteria.webp";
import moldavaPuntas from "@/lib/sitio/moldava-puntas.webp";

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
  ...metadatosDePagina({
    titulo: "Moldava — molduras y listonería en pino finger joint",
    descripcion:
      `Línea propia de Maderera Juan B. Justo: molduras y listonería en pino finger joint, sin nudos, en piezas uniformes de 3,05 m. Venta minorista y mayorista en ${ALCANCE_MOLDAVA}.`,
    ruta: "/moldava",
  }),
  keywords: [
    "moldava",
    "molduras pino finger joint",
    "listoneria pino sin nudos",
    "molduras mayorista buenos aires",
    "zocalos pino finger",
  ],
};

const PROCESO = [
  {
    icono: Factory,
    titulo: "Producción propia",
    detalle: "Hecha en nuestra planta.",
  },
  {
    icono: Ruler,
    titulo: "Sistema Finger Joint",
    detalle: "Pino sin nudos, en piezas de 3,05 m.",
  },
  {
    icono: Truck,
    titulo: "Mayorista con entrega en puerta",
    detalle: `Entrega en puerta en ${ALCANCE_MOLDAVA}.`,
  },
];

/**
 * **Esta página no le pregunta a nadie quién es, y por eso es estática.**
 *
 * Es una presentación fija de la línea propia: el mismo texto y la misma grilla
 * para todo el que entra. Leía la sesión por dos cosas —el precio de lista y si
 * mostrar con IVA o sin IVA— y eso obligaba a armarla de nuevo en cada visita,
 * incluidas las de los buscadores, que es justamente por quienes existe.
 *
 * La página sale armada con el precio de público, y el del profesional y su
 * vista de IVA llegan en la misma respuesta, detrás del `<Suspense>` de cada
 * tarjeta. Ver `components/product-card.tsx`.
 */
export default async function MoldavaPage() {
  // La grilla es una muestra, no el catálogo: debajo está el enlace a la lista
  // completa filtrada por la marca. Go corta antes de armar las tarjetas.
  const [productos, whatsapp, numero] = await Promise.all([
    listarProductosPublicos({ marca: "Moldava", orden: "relevancia", limite: POR_PAGINA }),
    enlaceWhatsapp(
      "Hola! Quería consultar por la línea Moldava y precios mayoristas.",
    ),
    numeroWhatsapp(),
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
        foto={moldavaEstanteria}
        titulo="Moldava"
        bajada="Nuestra línea propia de molduras y listonería en pino finger joint."
      />

      <div className="contenedor space-y-14 py-12">
        {/* El acceso mayorista, arriba de todo.

            Estaba al final de la página, en un bloque discreto: quien viene a
            Moldava buscando precio mayorista es justo el visitante que la
            clienta quiere captar, y le hacía falta bajar la página entera para
            encontrar cómo. */}
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-[14px] superficie p-6">
          <div>
            <h2 className="text-lg font-bold">¿Comprás al por mayor?</h2>
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
            <BotonWhatsapp enlace={whatsapp} variante="secundario">
              Consultar por WhatsApp
            </BotonWhatsapp>
          </div>
        </section>

        {/* La moldura a la vista y el proceso en tres renglones: eran tres
            tarjetas de párrafo y ninguna foto del producto propio. */}
        <section className="grid items-center gap-8 lg:grid-cols-[1.2fr_1fr]">
          <div className="relative h-[300px] overflow-hidden rounded-2xl sm:h-[420px]">
            <Image
              src={moldavaPuntas}
              alt="Perfiles Moldava de punta, en la estantería del depósito"
              fill
              placeholder="blur"
              className="object-cover"
              sizes="(max-width: 1024px) 100vw, 55vw"
            />
          </div>
          <ul className="space-y-6">
            {PROCESO.map((paso) => (
              <li key={paso.titulo} className="flex items-center gap-4">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-naranja-claro text-acento-texto">
                  <paso.icono className="h-6 w-6" />
                </span>
                <span>
                  <h2 className="text-xl font-bold tracking-[-0.01em]">{paso.titulo}</h2>
                  <p className="text-[15px] text-texto-2">{paso.detalle}</p>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold">La línea</h2>
              <p className="mt-0.5 text-[15px] text-texto-2">
                {productos.length > 0
                  ? "Zócalos, marcos, cornisas y listonería."
                  : "Consultanos la línea por WhatsApp."}
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
                <ProductCard key={p.id} product={p} whatsapp={numero} />
              ))}
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
