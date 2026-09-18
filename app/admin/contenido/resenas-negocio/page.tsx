import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Star } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { requireStaff } from "@/lib/dal/session";
import { listarResenasDelNegocio } from "@/lib/google/resenas";
import { EditorDeResenas } from "./editor";

export const metadata: Metadata = { title: "Reseñas del negocio" };

/**
 * Las reseñas que se ven en la portada.
 *
 * **No son las de producto.** Aquéllas son de compra verificada y hablan de una
 * placa; éstas hablan del negocio —la atención, el corte, la entrega— y son las
 * que alguien lee antes de decidir si compra acá. La clienta las pidió al pedir
 * «sumar reseñas de Google».
 *
 * Se cargan de dos formas y conviven: copiadas a mano de Google —eligiendo
 * cuáles— y traídas por la API de Places cuando haya clave. Las de Google entran
 * **sin publicar**: Google devuelve las cinco que él elige, y no siempre son las
 * que uno pondría al frente del negocio.
 */
export default async function ResenasDelNegocioPage() {
  await requireStaff();

  const resenas = await listarResenasDelNegocio();
  const hayGoogle = Boolean(
    process.env.GOOGLE_PLACES_API_KEY && process.env.GOOGLE_PLACE_ID,
  );

  return (
    <div className="space-y-6">
      <Link
        href="/admin/contenido"
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
        Volver a contenido
      </Link>

      <EncabezadoPanel
        titulo="Reseñas del negocio"
        detalle={
          resenas.length > 0
            ? `${resenas.filter((r) => r.publicada).length} publicadas de ${resenas.length} cargadas`
            : "Todavía no hay ninguna cargada"
        }
      />

      {!hayGoogle && (
        <p className="tarjeta-atencion flex items-start gap-2.5 p-4 text-base">
          <Star className="mt-0.5 h-5 w-5 shrink-0 text-brand-orange" />
          <span>
            Todavía no está conectada la cuenta de Google, así que las reseñas se
            copian a mano de la ficha del negocio. Cuando lleguen las claves
            —<code className="tabular">GOOGLE_PLACES_API_KEY</code> y{" "}
            <code className="tabular">GOOGLE_PLACE_ID</code>— aparece el botón
            para traerlas solas y lo cargado sigue funcionando igual.
          </span>
        </p>
      )}

      <EditorDeResenas
        resenas={resenas.map((r) => ({
          id: r.id,
          autor: r.autor,
          estrellas: r.estrellas,
          texto: r.texto,
          fecha: r.fecha.toISOString().slice(0, 10),
          origen: r.origen,
          publicada: r.publicada,
        }))}
        hayGoogle={hayGoogle}
      />
    </div>
  );
}
