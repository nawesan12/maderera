"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Calculator,
  Loader2,
  MessageCircle,
  Search,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PASO_INICIAL,
  pasoPorId,
  type PasoDelGuion,
} from "@/lib/asistente/guion";
import {
  buscarConElAsistente,
  datosDelAsistente,
  productosDelRubro,
  rubrosDelAsistente,
  type DatoDelAsistente,
  type ProductoDelAsistente,
  type RubroDelAsistente,
} from "@/app/(public)/asistente-actions";
import { formatearPrecio } from "@/lib/formato";

/** Un renglón de la conversación. */
type Renglon =
  | { tipo: "asistente"; texto: string }
  | { tipo: "persona"; texto: string }
  | { tipo: "productos"; items: ProductoDelAsistente[] }
  | { tipo: "datos"; items: DatoDelAsistente[] }
  | { tipo: "vacio"; texto: string };

const CALCULADORAS: Record<string, string> = {
  techos: "/calculadora#techos",
  placas: "/calculadora#placas",
  pisos: "/calculadora#pisos",
  decks: "/calculadora#decks",
};

/**
 * El asistente del sitio.
 *
 * Guía por botones y busca en el catálogo real. No hay modelo de lenguaje
 * detrás y es a propósito: lo que se pregunta en una maderera es un conjunto
 * chico y conocido, y una respuesta escrita por el negocio no inventa un precio
 * ni promete un plazo que nadie prometió. Ver `lib/asistente/guion.ts`.
 *
 * Todo el estado vive acá y nada se guarda: cerrar el panel es empezar de
 * nuevo. Una conversación a medias que reaparece tres días después es peor que
 * ninguna.
 */
export function PanelDelAsistente({ enlaceWhatsapp }: { enlaceWhatsapp: string }) {
  const [abierto, setAbierto] = useState(false);
  const [paso, setPaso] = useState<PasoDelGuion>(() => pasoPorId(PASO_INICIAL)!);
  const [renglones, setRenglones] = useState<Renglon[]>([
    { tipo: "asistente", texto: pasoPorId(PASO_INICIAL)!.mensaje },
  ]);
  const [rubros, setRubros] = useState<RubroDelAsistente[]>([]);
  const [texto, setTexto] = useState("");
  const [trabajando, setTrabajando] = useState(false);

  const finRef = useRef<HTMLDivElement>(null);

  // Los rubros salen del catálogo y se piden una sola vez, cuando se abre.
  useEffect(() => {
    if (!abierto || rubros.length > 0) return;
    void rubrosDelAsistente().then(setRubros);
  }, [abierto, rubros.length]);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [renglones]);

  function decir(nuevos: Renglon[]) {
    setRenglones((previos) => [...previos, ...nuevos]);
  }

  async function ir(id: string, textoDelBoton?: string) {
    const destino = pasoPorId(id);
    if (!destino) return;

    if (textoDelBoton) decir([{ tipo: "persona", texto: textoDelBoton }]);

    setPaso(destino);
    decir([{ tipo: "asistente", texto: destino.mensaje }]);
    setTexto("");

    const accion = destino.accion;
    if (!accion) return;

    if (accion.tipo === "dato") {
      setTrabajando(true);
      const items = await datosDelAsistente(accion.cual);
      setTrabajando(false);
      decir([{ tipo: "datos", items }]);
    }

    if (accion.tipo === "categoria") {
      setTrabajando(true);
      const items = await productosDelRubro(accion.slug);
      setTrabajando(false);
      decir(
        items.length > 0
          ? [{ tipo: "productos", items }]
          : [{ tipo: "vacio", texto: "No tengo nada cargado en ese rubro." }],
      );
    }
  }

  async function elegirRubro(rubro: RubroDelAsistente) {
    decir([{ tipo: "persona", texto: rubro.nombre }]);
    setTrabajando(true);
    const items = await productosDelRubro(rubro.slug);
    setTrabajando(false);

    decir(
      items.length > 0
        ? [
            { tipo: "asistente", texto: `Esto es lo que tengo de ${rubro.nombre.toLowerCase()}:` },
            { tipo: "productos", items },
          ]
        : [{ tipo: "vacio", texto: "No tengo nada cargado en ese rubro." }],
    );
  }

  async function buscar() {
    const consulta = texto.trim();
    if (consulta.length < 2 || trabajando) return;

    decir([{ tipo: "persona", texto: consulta }]);
    setTexto("");
    setTrabajando(true);
    const items = await buscarConElAsistente(consulta);
    setTrabajando(false);

    decir(
      items.length > 0
        ? [{ tipo: "productos", items }]
        : [
            {
              tipo: "vacio",
              texto:
                "No encontré nada con eso. Probá con otra palabra, o pasale la consulta a alguien del mostrador.",
            },
          ],
    );
  }

  const buscando = paso.accion?.tipo === "buscar";
  const enRubros = paso.id === "rubros";
  const calculadora =
    paso.accion?.tipo === "calculadora" ? CALCULADORAS[paso.accion.cual] : null;
  const aWhatsapp = paso.accion?.tipo === "whatsapp";
  const irA = paso.accion?.tipo === "ir" ? paso.accion.ruta : null;

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-label="Abrir el asistente"
        className="fixed bottom-6 right-[5.5rem] z-50 flex h-14 w-14 items-center justify-center rounded-full bg-accion text-white shadow-lg transition-all hover:scale-110 hover:shadow-xl"
      >
        <Sparkles className="h-6 w-6" />
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Asistente"
      className="fixed inset-x-3 bottom-3 z-50 flex max-h-[min(80vh,620px)] flex-col overflow-hidden rounded-2xl border border-linea bg-card shadow-[0_24px_50px_-20px_rgb(60_50_40_/_0.45)] sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[420px]"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-linea px-4 py-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-naranja-claro">
          <Sparkles className="h-4 w-4 text-acento-texto" />
        </span>
        <div className="flex-1">
          <p className="font-semibold leading-tight">Te ayudo a encontrar</p>
          <p className="text-sm text-texto-3">Maderera Juan B. Justo</p>
        </div>
        <button
          type="button"
          onClick={() => setAbierto(false)}
          aria-label="Cerrar el asistente"
          className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-sitio-alt"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-sitio-alt px-4 py-4">
        {renglones.map((renglon, i) => (
          <Renglon key={i} renglon={renglon} />
        ))}

        {trabajando && (
          <p className="flex items-center gap-2 text-sm text-texto-3">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Buscando…
          </p>
        )}

        <div ref={finRef} />
      </div>

      <div className="shrink-0 space-y-2.5 border-t border-linea px-4 py-3">
        {buscando && (
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-texto-3" />
              <Input
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void buscar();
                  }
                }}
                placeholder="Fenólico 18, machimbre…"
                className="pl-9"
                autoFocus
              />
            </div>
            <Button
              type="button"
              onClick={() => void buscar()}
              disabled={texto.trim().length < 2 || trabajando}
              aria-label="Buscar"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        )}

        {enRubros && rubros.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {rubros.map((r) => (
              <button
                key={r.slug}
                type="button"
                onClick={() => void elegirRubro(r)}
                className="rounded-full border border-linea px-3 py-1.5 text-sm font-medium transition-colors hover:bg-chip"
              >
                {r.nombre}
                <span className="ml-1 text-texto-3">{r.cantidad}</span>
              </button>
            ))}
          </div>
        )}

        {calculadora && (
          <Button
            render={<Link href={calculadora} />}
            className="w-full bg-accion text-white hover:bg-accion-hover"
          >
            <Calculator className="h-4 w-4" />
            Abrir la calculadora
          </Button>
        )}

        {aWhatsapp && (
          <Button
            render={
              <a href={enlaceWhatsapp} target="_blank" rel="noopener noreferrer" />
            }
            className="w-full bg-[#25D366] text-white hover:bg-[#1fb757]"
          >
            <MessageCircle className="h-4 w-4" />
            Escribir por WhatsApp
          </Button>
        )}

        {irA && (
          <Button render={<Link href={irA} />} variant="outline" className="w-full">
            Ver más
            <ArrowRight className="h-4 w-4" />
          </Button>
        )}

        <div className="flex flex-wrap gap-1.5">
          {paso.opciones.map((opcion) => (
            <button
              key={`${opcion.va}-${opcion.texto}`}
              type="button"
              onClick={() => void ir(opcion.va, opcion.texto)}
              className="rounded-full bg-chip px-3.5 py-2 text-sm font-medium transition-colors hover:bg-linea"
            >
              {opcion.texto}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Renglon({ renglon }: { renglon: Renglon }) {
  if (renglon.tipo === "persona") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-accion px-3.5 py-2.5 text-[15px] text-white">
          {renglon.texto}
        </p>
      </div>
    );
  }

  if (renglon.tipo === "asistente") {
    return (
      <div className="flex justify-start">
        <p className="max-w-[90%] rounded-2xl rounded-bl-sm bg-card px-3.5 py-2.5 text-[15px] shadow-sm">
          {renglon.texto}
        </p>
      </div>
    );
  }

  if (renglon.tipo === "vacio") {
    return (
      <p className="rounded-xl border border-dashed border-linea px-3.5 py-3 text-sm text-texto-2">
        {renglon.texto}
      </p>
    );
  }

  if (renglon.tipo === "datos") {
    return (
      <ul className="space-y-1.5">
        {renglon.items.map((d) => (
          <li
            key={d.titulo}
            className="rounded-xl bg-card px-3.5 py-2.5 shadow-sm"
          >
            <p className="text-[15px] font-semibold">{d.titulo}</p>
            <p className="text-sm text-texto-2">{d.detalle}</p>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className="space-y-1.5">
      {renglon.items.map((p) => (
        <li key={p.slug}>
          <Link
            href={`/catalogo/${p.slug}`}
            prefetch={false}
            className="flex items-center gap-3 rounded-xl bg-card p-2.5 shadow-sm transition-colors hover:bg-chip"
          >
            {p.imagen ? (
              <Image
                src={p.imagen}
                alt=""
                width={48}
                height={48}
                className="h-12 w-12 shrink-0 rounded-lg object-cover"
              />
            ) : (
              <span className="h-12 w-12 shrink-0 rounded-lg bg-brand-wood-light/30" />
            )}

            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium">
                {p.nombre}
              </span>
              <span className="block text-sm text-texto-3">
                {p.medida ?? p.categoria}
              </span>
            </span>

            <span className="shrink-0 text-right">
              <span className="block text-[15px] font-semibold">
                {formatearPrecio(p.precioDesde)}
              </span>
              {!p.hayStock && (
                <span className="block text-xs text-texto-3">a pedido</span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
