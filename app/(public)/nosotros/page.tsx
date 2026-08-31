import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Award, Shield, Truck, Users } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ANIO_FUNDACION, numerosDeLaEmpresa } from "@/lib/dal/catalog";
import { DatosEstructurados } from "@/components/datos-estructurados";
import { migasJsonLd } from "@/lib/seo";

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
    "Empresa familiar fundada en 1981 en Mar del Plata. Más de cuatro décadas proveyendo madera de calidad. Marca propia Moldava con distribución nacional.",
  keywords: [
    "maderera juan b justo historia",
    "moldava molduras",
    "empresa madera mar del plata",
    "maderera desde 1981",
  ],
  alternates: { canonical: "/nosotros" },
};

/**
 * La trayectoria, tal como la contaba el prototipo.
 *
 * PENDIENTE DE CONFIRMAR CON EL CLIENTE. Viene del prototipo y no está
 * verificada. Ya se sacó un hito que era demostrablemente falso —"2010:
 * apertura de la sucursal en Av. Constitución", que no es ninguna de las dos
 * que opera—, pero el resto sigue sin confirmar y está anotado en
 * `docs/CAMBIOS.md` como insumo pendiente. Los demás no se tocan: inventar la
 * historia de otro es peor que no contarla.
 */
const TRAYECTORIA = [
  { anio: "1981", titulo: "Fundación", detalle: "Nace Maderera Juan B. Justo como una empresa familiar dedicada a la venta de maderas en bruto en Mar del Plata." },
  { anio: "1990", titulo: "Expansión a techos", detalle: "Incorporamos la elaboración de techos, machimbres y molduras. Ampliamos nuestro aserradero con tecnología moderna." },
  { anio: "2000", titulo: "Placas y corte", detalle: "Sumamos la línea de placas y tableros con servicio de corte a medida. Instalamos maquinaria de precisión." },
  { anio: "2005", titulo: "Marca Moldava", detalle: "Creamos Moldava, nuestra marca propia de molduras y listonería en pino finger joint, con distribución nacional." },
  { anio: "2015", titulo: "Ferretería y más", detalle: "Incorporamos la sección de ferretería con herrajes, accesorios, lacas y todo para el acabado de tu proyecto." },
  { anio: "2020", titulo: "Construcción en seco", detalle: "Sumamos la línea completa de construcción en seco: placas de yeso, perfiles y aislantes." },
  { anio: "2026", titulo: "Tienda y gestión online", detalle: "Catálogo con stock por sucursal, calculadoras de materiales, presupuestos y cuenta corriente desde el sitio." },
];

const VALORES = [
  { icono: Award, titulo: "Calidad", detalle: "Seleccionamos los mejores materiales para garantizar resultados duraderos." },
  { icono: Users, titulo: "Servicio", detalle: "Asesoramiento personalizado con un equipo que conoce cada producto." },
  { icono: Truck, titulo: "Logística", detalle: "Entrega en obra con flota propia en Mar del Plata y alrededores." },
  { icono: Shield, titulo: "Confianza", detalle: "Cuatro décadas respaldando a profesionales y particulares con seriedad." },
];

const MOLDAVA = [
  "Producción propia con control de calidad",
  "Pino finger joint de primera selección",
  "Distribución nacional",
  "Variedad de perfiles: zócalos, marcos, cornisas y más",
  "Listos para pintar o lacar",
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

      <section className="relative overflow-hidden bg-brand-gray py-24">
        <div className="contenedor relative z-10 animate-in text-center text-white fade-in slide-in-from-bottom-4 duration-700">
          <p className="mb-6 inline-block rounded-full border border-brand-orange/30 bg-brand-orange/20 px-3 py-1 text-sm text-brand-orange">
            Nuestra historia
          </p>
          <h1 className="mb-4 text-4xl font-bold sm:text-5xl">
            Más de {numeros.anios} años construyendo{" "}
            <span className="text-brand-orange">confianza</span>
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-white/70">
            Desde {ANIO_FUNDACION} somos una empresa familiar que creció junto a Mar
            del Plata, proveyendo los mejores productos de la industria maderera.
          </p>
        </div>
      </section>

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
                Moldava es nuestra marca propia de molduras y listonería en pino
                finger joint. Con producción en nuestro aserradero de Mar del
                Plata, distribuimos a todo el país con los más altos estándares
                de calidad.
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
