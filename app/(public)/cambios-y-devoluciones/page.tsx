import type { Metadata } from "next";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { EncabezadoPublico } from "@/components/encabezado-publico";
import { DatosEstructurados } from "@/components/datos-estructurados";
import { migasJsonLd } from "@/lib/seo";
import { enlaceWhatsapp } from "@/lib/whatsapp/enlace";
import { HORARIO_CORTES } from "@/lib/sucursales";

/**
 * Cambios y devoluciones.
 *
 * El sitio no tenía **ninguna** página legal: ni términos, ni privacidad, ni
 * política de cambios. Para una tienda que cobra online eso es un hueco, y el
 * brief además contestó la pregunta con criterio propio.
 *
 * **El texto es deliberadamente honesto sobre lo que no está decidido.** El
 * cliente escribió: *"Aceptamos sugerencias! al momento chequeamos los tiempos
 * desde que retiraron la mercadería, depende de la mercadería hay que chequear
 * si hay por lo que quiere cambiar ya que las unidades de medidas son muy
 * distintas y el stock es variable cada día. Creo que deberían comunicarse al
 * WhatsApp directo en ese caso"*.
 *
 * Así que la página dice lo que la maderera de verdad hace —se mira caso por
 * caso y se resuelve por WhatsApp— en vez de inventar un plazo fijo de treinta
 * días que después nadie va a respetar. Prometer una política que el mostrador
 * no cumple es peor que no tener ninguna.
 */

export const metadata: Metadata = {
  title: "Cambios y devoluciones",
  description:
    "Cómo resolvemos un cambio o una devolución en Maderera Juan B. Justo: se mira caso por caso, según el material y el tiempo transcurrido. Escribinos por WhatsApp.",
  alternates: { canonical: "/cambios-y-devoluciones" },
};

export default async function CambiosPage() {
  const whatsapp = await enlaceWhatsapp(
    "Hola! Necesito consultar por un cambio o una devolución.",
  );

  return (
    <div className="min-h-screen">
      <DatosEstructurados
        datos={migasJsonLd([
          { nombre: "Inicio", ruta: "/" },
          { nombre: "Cambios y devoluciones", ruta: "/cambios-y-devoluciones" },
        ])}
      />

      <EncabezadoPublico
        titulo="Cambios y devoluciones"
        bajada="Cómo lo resolvemos, y por qué preferimos hablarlo."
      />

      <div className="contenedor max-w-3xl space-y-8 py-12">
        <section className="space-y-3">
          <h2 className="text-xl font-bold">Cada caso se mira</h2>
          <p className="text-[15.5px] leading-relaxed text-texto-2">
            No tenemos un plazo único, y es a propósito. Una placa entera sin
            cortar, una tirantería a medida y un tarro de laca abierto no son la
            misma situación: las unidades de medida son muy distintas y el stock
            cambia todos los días.
          </p>
          <p className="text-[15.5px] leading-relaxed text-texto-2">
            Lo que miramos en cada caso es <strong>cuánto tiempo pasó desde que
            retiraste la mercadería</strong>, en qué estado está y si tenemos
            disponible aquello por lo que la querés cambiar.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">Lo que no se cambia</h2>
          <ul className="space-y-2 text-[15.5px] leading-relaxed text-texto-2">
            <li className="flex gap-2.5">
              <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-acento-texto" />
              <span>
                <strong>La mercadería cortada o maquinada a tu medida.</strong>{" "}
                Una placa que se cortó según tus medidas, o una escalera hecha a
                pedido, no se puede volver a vender.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-acento-texto" />
              <span>
                <strong>Los productos abiertos o usados</strong> —lacas,
                selladores, adhesivos— salvo que tengan una falla.
              </span>
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">Si el producto vino fallado</h2>
          <p className="text-[15.5px] leading-relaxed text-texto-2">
            Es otra cosa y se resuelve aparte: avisanos apenas lo veas, con el
            número de pedido o el remito a mano. La madera es un material
            natural y tiene variaciones propias —vetas, tonos, algún nudo—; eso
            no es una falla, pero cualquier duda la miramos con vos.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">
            Devolución del dinero o compra desconocida
          </h2>
          <p className="text-[15.5px] leading-relaxed text-texto-2">
            Si pediste que te devolvamos el dinero, o no reconocés una compra
            hecha con tu tarjeta, <strong>escribinos directo por WhatsApp</strong>.
            Son los dos casos que no se resuelven por formulario: hace falta
            identificar la operación y hablar con administración.
          </p>
        </section>

        <section className="rounded-[14px] border border-linea bg-chip p-7 text-center">
          <h2 className="text-lg font-bold">Escribinos y lo vemos</h2>
          <p className="mx-auto mt-2 max-w-xl text-[15px] leading-relaxed text-texto-2">
            Tené a mano el número de pedido o el remito. Atendemos{" "}
            {HORARIO_CORTES.toLowerCase()}.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-accion px-5 font-semibold text-white transition-colors hover:bg-accion-hover"
            >
              <MessageCircle className="h-4 w-4" />
              Escribir por WhatsApp
            </a>
            <Link
              href="/contacto"
              className="inline-flex h-11 items-center rounded-[10px] border border-linea bg-card px-5 font-semibold transition-colors hover:bg-muted"
            >
              Otras formas de contacto
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
