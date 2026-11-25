import type { Metadata } from "next";
import Link from "next/link";
import { Landmark, Megaphone, Settings2, Star } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { listarAjustes, listarResenas } from "@/lib/dal/admin/contenido";
import { Ajustes } from "./secciones";
import { Resenas } from "./resenas";
import { InterruptoresDeTienda } from "./tienda";
import { leerTienda } from "@/lib/tienda";

export const metadata: Metadata = { title: "Contenido" };

/**
 * Contenido del sitio: avisos, testimonios, reseñas y textos.
 *
 * **El blog salió del sitio el 7/9/2026, por pedido de la clienta.** Las seis
 * notas que había las había escrito el prototipo y estaban publicadas con el
 * nombre de la maderera como autor; el brief dejaba en "a definir" quién
 * escribía los textos, y la decisión terminó siendo no tener blog. El
 * contenido quedó respaldado fuera del repo antes de borrarlo.
 *
 * Lo que sí se edita acá es lo que el sitio afirma en voz alta y cambia sin
 * necesitar un programador.
 */
export default async function ContenidoPage() {
  const [resenas, ajustes] = await Promise.all([
    listarResenas(),
    listarAjustes(),
  ]);
  // Los interruptores tienen su propia tarjeta: en la lista de textos
  // aparecían como un campo donde escribir «si» o «no».
  const tienda = leerTienda(Object.fromEntries(ajustes.map((a) => [a.clave, a.valor])));
  const textos = ajustes.filter((a) => a.clave !== "tienda_activa" && a.clave !== "stock_visible");

  return (
    <div className="space-y-6">
      <EncabezadoPanel
        titulo="Contenido"
      >
        <Link
          href="/admin/contenido/banners"
          className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted"
        >
          <Megaphone className="h-5 w-5" />
          Avisos y promociones
        </Link>
        <Link
          href="/admin/contenido/promociones"
          className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted"
        >
          <Landmark className="h-5 w-5" />
          Promociones bancarias
        </Link>
        {/* Las del negocio, distintas de las de producto que se moderan más
            abajo: éstas hablan de la atención y son las que van en la
            portada. */}
        <Link
          href="/admin/contenido/resenas-negocio"
          className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted"
        >
          <Star className="h-5 w-5" />
          Reseñas del negocio
        </Link>
      </EncabezadoPanel>

      <InterruptoresDeTienda tienda={tienda} />

      <Resenas resenas={resenas} />

      <section className="tarjeta p-5">
        <h2 className="flex items-center gap-2 text-base font-medium">
          <Settings2 className="h-5 w-5 text-muted-foreground" />
          Textos del sitio
        </h2>

        <div className="mt-4">
          <Ajustes ajustes={textos} />
        </div>
      </section>
    </div>
  );
}
