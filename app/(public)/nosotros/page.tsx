import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { EncabezadoPublico } from "@/components/encabezado-publico";
import { Award, Shield, Truck, Users } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ANIO_FUNDACION, numerosDeLaEmpresa } from "@/lib/dal/catalog";
import { DatosEstructurados } from "@/components/datos-estructurados";
import { migasJsonLd } from "@/lib/seo";
import { ALCANCE_MOLDAVA, masDeAnios } from "@/lib/empresa";

/**
 * Quiénes somos.
 *
 * Era una página de cliente entera para animar la entrada de cada bloque. Las
 * animaciones ahora son CSS (`tw-animate-css`), que hace lo mismo sin mandar
 * framer-motion al navegador en una página que no tiene ni un botón.
 *
 * Los números grandes salen de la base y del calendario. Estaban escritos a
 * mano y ya eran falsos: decía "43 años" cuando iban 45, y "200+ productos"
 * sin relación con el catálogo. Es de lo poco que un visitante puede
 * verificar solo, y un número inventado ahí desmiente todo lo demás.
 */

export const metadata: Metadata = {
  title: "Quiénes somos — desde 1981",
  description:
    `Empresa familiar fundada en ${ANIO_FUNDACION} en Mar del Plata. ${masDeAnios()} proveyendo madera de calidad. Marca propia Moldava, con entrega en ${ALCANCE_MOLDAVA}.`,
  keywords: [
    "maderera juan b justo historia",
    "moldava molduras",
    "empresa madera mar del plata",
    "maderera desde 1981",
  ],
  alternates: { canonical: "/nosotros" },
};

/**
 * La trayectoria: solo lo que el cliente confirmó.
 *
 * El brief del 5/9/2026 pedía los hitos y **volvió con el cuadro en blanco**:
 * la única fila tenía el año 1981 y la columna "qué pasó" vacía. Así que de
 * los siete hitos que traía el prototipo quedan los dos verificables —el año
 * de apertura, que el cliente sí confirmó, y la puesta en marcha de esta
 * plataforma, que es de este año y nos consta—.
 *
 * Los cinco intermedios (1990, 2000, 2005, 2015, 2020) se sacaron por la misma
 * regla que ya se aplicó al hito falso de 2010 —"apertura en Av. Constitución",
 * que no es ninguna de las dos sucursales que opera—: inventar la historia de
 * otro es peor que no contarla. Vuelven en cuanto el cliente los mande; está
 * anotado en `docs/CAMBIOS.md`.
 */
const TRAYECTORIA = [
  { anio: String(ANIO_FUNDACION), titulo: "Fundación", detalle: "Abre Maderera Juan B. Justo en Mar del Plata, como empresa familiar." },
  { anio: "2026", titulo: "Tienda y gestión online", detalle: "Catálogo con stock por sucursal, calculadoras de materiales, presupuestos y cuenta corriente desde el sitio." },
];

const VALORES = [
  { icono: Award, titulo: "Calidad", detalle: "Seleccionamos los mejores materiales para garantizar resultados duraderos." },
  { icono: Users, titulo: "Servicio", detalle: "Asesoramiento personalizado con un equipo que conoce cada producto." },
  { icono: Truck, titulo: "Logística", detalle: "Entrega en obra con flota propia en Mar del Plata y alrededores." },
  { icono: Shield, titulo: "Confianza", detalle: `${masDeAnios()} respaldando a profesionales y particulares con seriedad.` },
];

const MOLDAVA = [
  "Pino finger joint, sin nudos",
  "El dentado y pegado elimina las imperfecciones de la madera",
  "Piezas uniformes de 3,05 m de largo estándar",
  "Línea completa: zócalos, marcos, cornisas y listonería",
  `Venta mayorista en ${ALCANCE_MOLDAVA}, con entrega en puerta`,
];

export default async function NosotrosPage() {
  const numeros = await numerosDeLaEmpresa();

  const cifras = [
    { valor: `${numeros.anios}`, etiqueta: "Años de experiencia" },
    { valor: `${numeros.sucursales}`, etiqueta: "Sucursales en Mar del Plata" },
    { valor: `${numeros.medidas}`, etiqueta: "Medidas en catálogo" },
    { valor: `${numeros.rubros}`, etiqueta: "Rubros" },
  ];

  return (
    <div className="min-h-screen">
      <DatosEstructurados
        datos={migasJsonLd([
          { nombre: "Inicio", ruta: "/" },
          { nombre: "Quiénes somos", ruta: "/nosotros" },
        ])}
      />

      <EncabezadoPublico
        titulo="Nosotros"
        bajada={`Desde ${ANIO_FUNDACION} en Mar del Plata: ${numeros.anios} años de empresa familiar que creció con la ciudad.`}
      />

      <section className="py-16">
        <div className="contenedor">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {VALORES.map((valor) => (
              <div
                key={valor.titulo}
                className="h-full rounded-xl border bg-card p-6 text-center transition-shadow hover:shadow-lg"
              >
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-orange/10">
                  <valor.icono className="h-7 w-7 text-brand-orange" />
                </div>
                <h2 className="mb-2 font-semibold">{valor.titulo}</h2>
                <p className="text-sm text-muted-foreground">{valor.detalle}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-muted/50 py-16">
        <div className="contenedor">
          <h2 className="mb-12 text-center text-3xl font-bold">Nuestra trayectoria</h2>
          <ol className="mx-auto max-w-3xl">
            {TRAYECTORIA.map((hito, i) => (
              <li key={hito.anio} className="flex gap-6 pb-10 last:pb-0">
                <div className="flex flex-col items-center">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-orange">
                    <span className="text-xs font-bold text-white">{hito.anio}</span>
                  </div>
                  {i < TRAYECTORIA.length - 1 && (
                    <div aria-hidden className="mt-2 w-0.5 flex-1 bg-brand-orange/20" />
                  )}
                </div>
                <div className="pb-2">
                  <h3 className="text-lg font-semibold">{hito.titulo}</h3>
                  <p className="text-sm text-muted-foreground">{hito.detalle}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="py-16">
        <div className="contenedor">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <p className="mb-4 inline-block rounded-full border border-brand-green/30 bg-brand-green/10 px-3 py-1 text-sm text-brand-green">
                Marca propia
              </p>
              <h2 className="mb-4 text-3xl font-bold">Moldava</h2>
              <p className="mb-6 text-muted-foreground">
                Moldava es nuestra línea propia de molduras y listonería en
                pino finger joint, nacida en el proceso productivo de la
                maderera. El sistema Finger Joint elimina las imperfecciones de
                la madera y la vuelve a ensamblar por dentado y pegado, así que
                cada pieza sale uniforme y de 3,05 m de largo estándar. La
                vendemos a consumidor final y a mayoristas de {ALCANCE_MOLDAVA},
                con entrega en puerta y coordinación de envíos.
              </p>
              <ul className="mb-6 space-y-3">
                {MOLDAVA.map((item) => (
                  <li key={item} className="flex items-center gap-2 text-sm">
                    <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-brand-green" />
                    {item}
                  </li>
                ))}
              </ul>
              <Link href="/catalogo?cat=molduras" className={buttonVariants()}>
                Ver catálogo de molduras
              </Link>
            </div>

            <div className="relative h-80 overflow-hidden rounded-2xl bg-brand-gray lg:h-96">
              <Image
                src="https://images.unsplash.com/photo-1504148455328-c376907d081c?w=800&q=80"
                alt="Molduras Moldava"
                fill
                sizes="(min-width: 1024px) 50vw, 100vw"
                className="object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="bg-brand-orange py-16 text-white">
        <div className="contenedor">
          <dl className="grid grid-cols-2 gap-8 text-center md:grid-cols-4">
            {cifras.map((cifra) => (
              <div key={cifra.etiqueta}>
                <dd className="tabular text-4xl font-bold">{cifra.valor}</dd>
                <dt className="mt-1 text-sm text-white/70">{cifra.etiqueta}</dt>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </div>
  );
}
