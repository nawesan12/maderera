import type { Metadata } from "next";
import Link from "next/link";
import { EncabezadoPublico } from "@/components/encabezado-publico";
import {
  Calculator,
  Clock,
  Mail,
  MapPin,
  MessageCircle,
  Package,
  Phone,
} from "lucide-react";
import { listarSucursalesPublicas } from "@/lib/dal/envios";
import { ajuste } from "@/lib/dal/contenido";
import { DatosEstructurados } from "@/components/datos-estructurados";
import { migasJsonLd } from "@/lib/seo";
import { FormularioContacto } from "./formulario";

/**
 * Contacto.
 *
 * Dos cambios de fondo respecto de lo que había. Los datos de cada sucursal
 * salen de la base, como en el resto del sitio. Y el formulario **manda de
 * verdad**: antes el botón mostraba "Mensaje enviado correctamente" sin
 * mandar nada —los campos ni siquiera tenían `name`—, así que toda consulta
 * hecha desde acá se perdía y quien la escribió se quedaba esperando.
 */

export const metadata: Metadata = {
  title: "Contacto",
  description:
    "Escribinos, llamanos o pasá por cualquiera de nuestras dos sucursales en Mar del Plata. Presupuestos sin cargo y asesoramiento sobre materiales.",
  keywords: [
    "maderera mar del plata contacto",
    "presupuesto madera mar del plata",
    "telefono maderera juan b justo",
  ],
  alternates: { canonical: "/contacto" },
};

const ATAJOS = [
  {
    href: "/presupuesto",
    icono: Package,
    titulo: "Pedir un presupuesto",
    detalle: "Armá la lista y te pasamos el precio con validez.",
  },
  {
    href: "/calculadora",
    icono: Calculator,
    titulo: "Calcular materiales",
    detalle: "Cuánta madera lleva un techo, un deck o un piso.",
  },
  {
    href: "/stock",
    icono: MapPin,
    titulo: "Ver disponibilidad",
    detalle: "Qué hay en cada sucursal antes de venir.",
  },
];

export default async function ContactoPage() {
  const [sucursales, whatsapp] = await Promise.all([
    listarSucursalesPublicas(),
    ajuste("whatsapp_principal", "5492235903118"),
  ]);

  return (
    <div className="min-h-screen bg-sitio-alt">
      <DatosEstructurados
        datos={migasJsonLd([
          { nombre: "Inicio", ruta: "/" },
          { nombre: "Contacto", ruta: "/contacto" },
        ])}
      />

      <EncabezadoPublico
        titulo="Contacto"
        bajada="Escribinos, llamanos o pasá por el local. Te contestamos el mismo día hábil."
      />

      <div className="contenedor grid gap-8 py-12 lg:grid-cols-[1fr_380px]">
        <FormularioContacto whatsapp={whatsapp.replace(/\D/g, "")} />

        <aside className="space-y-6">
          <div className="space-y-3">
            {ATAJOS.map((atajo) => (
              <Link
                key={atajo.href}
                href={atajo.href}
                className="flex items-start gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-brand-orange/50 hover:bg-muted/40"
              >
                <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-orange/10">
                  <atajo.icono className="h-5 w-5 text-brand-orange" />
                </span>
                <span>
                  <span className="block font-medium">{atajo.titulo}</span>
                  <span className="block text-sm text-muted-foreground">
                    {atajo.detalle}
                  </span>
                </span>
              </Link>
            ))}
          </div>

          {sucursales.map((sucursal) => (
            <div key={sucursal.id} className="rounded-xl border bg-card p-5">
              <h2 className="font-semibold">{sucursal.nombre}</h2>

              <dl className="mt-3 space-y-2.5 text-sm">
                <div className="flex items-start gap-2.5">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-orange" />
                  <dd>{sucursal.direccion}</dd>
                </div>

                {sucursal.telefono && (
                  <div className="flex items-center gap-2.5">
                    <Phone className="h-4 w-4 shrink-0 text-brand-orange" />
                    <dd>
                      <a
                        href={`tel:${sucursal.telefono.replace(/[^\d+]/g, "")}`}
                        className="hover:text-brand-orange"
                      >
                        {sucursal.telefono}
                      </a>
                    </dd>
                  </div>
                )}

                {sucursal.email && (
                  <div className="flex items-center gap-2.5">
                    <Mail className="h-4 w-4 shrink-0 text-brand-orange" />
                    <dd>
                      <a
                        href={`mailto:${sucursal.email}`}
                        className="hover:text-brand-orange"
                      >
                        {sucursal.email}
                      </a>
                    </dd>
                  </div>
                )}

                {sucursal.horario && (
                  <div className="flex items-center gap-2.5">
                    <Clock className="h-4 w-4 shrink-0 text-brand-orange" />
                    <dd>{sucursal.horario}</dd>
                  </div>
                )}

                {sucursal.whatsapp && (
                  <div className="flex items-center gap-2.5">
                    <MessageCircle className="h-4 w-4 shrink-0 text-brand-green" />
                    <dd>
                      <a
                        href={`https://wa.me/${sucursal.whatsapp.replace(/\D/g, "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-brand-orange"
                      >
                        Escribir por WhatsApp
                      </a>
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
