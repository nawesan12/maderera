"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Calculator,
  MessageCircle,
  Plus,
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
  equipajeDelAsistente,
  preguntarAlAsistente,
  productosDelRubro,
  type DatoDelAsistente,
  type EquipajeDelAsistente,
  type ProductoDelAsistente,
} from "@/app/(public)/asistente-actions";
import { responderLocal } from "@/lib/asistente/respuestas";
import { formatearPrecio } from "@/lib/formato";
import { useCarrito } from "@/lib/carrito-context";

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
  const [equipaje, setEquipaje] = useState<EquipajeDelAsistente | null>(null);
  const [texto, setTexto] = useState("");
  const [trabajando, setTrabajando] = useState(false);

  /** Lo que dejó la última respuesta escrita a mano: botones, calculadora, WhatsApp. */
  const [extra, setExtra] = useState<{
    sugerencias: { texto: string; va: string }[];
    calculadora: string | null;
    aPersona: boolean;
  }>({ sugerencias: [], calculadora: null, aPersona: false });

  const finRef = useRef<HTMLDivElement>(null);

  /*
   * Una sola llamada, y solo al abrir.
   *
   * Trae los rubros, los horarios, las zonas de envío y las formas de pago:
   * todo lo que es igual para cualquiera. Con eso adentro, esas preguntas se
   * contestan en el navegador y no vuelven a molestar al servidor. Quien nunca
   * abre el panel no cuesta ni esta llamada.
   */
  useEffect(() => {
    if (!abierto || equipaje) return;
    void equipajeDelAsistente().then(setEquipaje);
  }, [abierto, equipaje]);

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
    setExtra({ sugerencias: [], calculadora: null, aPersona: false });

    const accion = destino.accion;
    if (!accion) return;

    if (accion.tipo === "dato" && equipaje) {
      // Ya están en el navegador desde que se abrió el panel.
      decir([{ tipo: "datos", items: equipaje[accion.cual] }]);
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

  async function elegirRubro(rubro: EquipajeDelAsistente["rubros"][number]) {
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

  /**
   * Lo que se escribe con palabras propias.
   *
   * El servidor lee la intención y contesta con el catálogo de verdad. La
   * demora simulada es a propósito: la respuesta vuelve en menos de lo que
   * tarda alguien en leer lo que acaba de escribir, y aparecer instantáneo se
   * siente a formulario y no a conversación.
   */
  async function preguntar(consultaCruda?: string) {
    const consulta = (consultaCruda ?? texto).trim();
    if (consulta.length < 1 || trabajando) return;

    decir([{ tipo: "persona", texto: consulta }]);
    setTexto("");
    setTrabajando(true);

    /*
     * Lo que se puede contestar acá, se contesta acá.
     *
     * El motor de intención es lógica pura, así que corre igual en el
     * navegador, y los datos del negocio ya bajaron al abrir. Preguntar el
     * horario no tiene por qué costar una ida al servidor. Lo único que sí va
     * es buscar productos: el precio depende de la lista de quien mira.
     */
    const local = equipaje ? responderLocal(consulta, equipaje) : null;

    const [respuesta] = await Promise.all([
      local ?? preguntarAlAsistente(consulta),
      new Promise((listo) => setTimeout(listo, local ? 320 : 550)),
    ]);

    setTrabajando(false);

    const nuevos: Renglon[] = [{ tipo: "asistente", texto: respuesta.texto }];

    const productos = "productos" in respuesta ? respuesta.productos : undefined;
    if (productos?.length) {
      nuevos.push({ tipo: "productos", items: productos });
    }
    if (respuesta.datos?.length) {
      nuevos.push({ tipo: "datos", items: respuesta.datos });
    }

    decir(nuevos);
    setExtra({
      sugerencias: respuesta.sugerencias ?? [],
      calculadora: respuesta.calculadora ?? null,
      aPersona: respuesta.aPersona ?? false,
    });
  }

  const enRubros = paso.id === "rubros";
  const calculadora =
    extra.calculadora
      ? CALCULADORAS[extra.calculadora]
      : paso.accion?.tipo === "calculadora"
        ? CALCULADORAS[paso.accion.cual]
        : null;
  const aWhatsapp = extra.aPersona || paso.accion?.tipo === "whatsapp";
  const irA = paso.accion?.tipo === "ir" ? paso.accion.ruta : null;

  // Los botones del guion, más los que dejó la última respuesta escrita.
  const opciones = [...extra.sugerencias, ...paso.opciones];

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

        {/* Los tres puntitos de siempre. No es adorno: sin una señal de que
            algo está pasando, medio segundo de espera se lee como que el botón
            no anduvo y la gente vuelve a tocar. */}
        {trabajando && (
          <div className="flex justify-start">
            <p className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-card px-4 py-3 shadow-sm">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-texto-3 [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-texto-3 [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-texto-3" />
              <span className="sr-only">Escribiendo…</span>
            </p>
          </div>
        )}

        <div ref={finRef} />
      </div>

      <div className="shrink-0 space-y-2.5 border-t border-linea px-4 py-3">
        {/* La caja está siempre, no solo en el paso de buscar: se puede
            preguntar cualquier cosa en cualquier momento, que es lo que
            distingue una conversación de un formulario con botones. */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-texto-3" />
            <Input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void preguntar();
                }
              }}
              placeholder="Escribime lo que necesitás…"
              className="pl-9"
              aria-label="Escribí tu consulta"
            />
          </div>
          <Button
            type="button"
            onClick={() => void preguntar()}
            disabled={texto.trim().length < 1 || trabajando}
            aria-label="Enviar"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>

        {enRubros && (equipaje?.rubros.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {equipaje!.rubros.map((r) => (
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
          {opciones.map((opcion) => (
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
        <li key={p.slug} className="flex items-stretch gap-1.5">
          <Link
            href={`/catalogo/${p.slug}`}
            prefetch={false}
            className="flex flex-1 items-center gap-3 rounded-xl bg-card p-2.5 shadow-sm transition-colors hover:bg-chip"
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

          {/* Se puede sumar al presupuesto sin salir de la conversación. Es la
              diferencia entre un asistente que informa y uno que sirve para
              algo: la persona ya dijo qué necesita, hacerla navegar hasta la
              ficha para tocar otro botón es perderla en el camino. */}
          <AgregarAlPresupuesto producto={p} />
        </li>
      ))}
    </ul>
  );
}

function AgregarAlPresupuesto({ producto }: { producto: ProductoDelAsistente }) {
  const { agregar, guardando } = useCarrito();
  const [puesto, setPuesto] = useState(false);

  // Sin precio no se puede presupuestar solo: eso se cotiza a mano.
  const sinPrecio = !producto.precioDesde || Number(producto.precioDesde) <= 0;
  if (sinPrecio) return null;

  return (
    <button
      type="button"
      disabled={guardando || puesto}
      onClick={() => {
        agregar({
          descripcion: producto.medida
            ? `${producto.nombre} — ${producto.medida}`
            : producto.nombre,
          cantidad: 1,
          origen: "asistente",
        });
        setPuesto(true);
      }}
      aria-label={`Agregar ${producto.nombre} al presupuesto`}
      className={`flex w-11 shrink-0 items-center justify-center rounded-xl shadow-sm transition-colors ${
        puesto
          ? "bg-brand-green/15 text-brand-green"
          : "bg-card hover:bg-chip disabled:opacity-50"
      }`}
    >
      {puesto ? "✓" : <Plus className="h-4 w-4" />}
    </button>
  );
}
