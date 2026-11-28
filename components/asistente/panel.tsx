"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Plus,
  Search,
  Send,
  X,
} from "lucide-react";
import { PersonajeAsistente } from "@/components/asistente/personaje";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PASO_INICIAL,
  pasoPorId,
  type PasoDelGuion,
} from "@/lib/asistente/guion";
import {
  preguntarAlAsistente,
  productosDelRubro,
  type DatoDelAsistente,
  type EquipajeDelAsistente,
  type RespuestaDelAsistente,
  type ProductoDelAsistente,
} from "@/app/(public)/asistente-actions";
import { formatearPrecio } from "@/lib/formato";
import { useCarrito } from "@/lib/carrito-context";
import { useTienda } from "@/lib/tienda-context";
import { ETIQUETA_ASISTENTE, EVENTO_ABRIR_ASISTENTE } from "@/lib/asistente/abrir";
import { mensajeDesdeElAsistente } from "@/lib/asistente/lenguaje";
import { BotonWhatsapp } from "@/components/whatsapp/boton";
import { MuestraDePlaca } from "@/components/catalogo/placa-de-producto";

/** Dónde queda el equipaje mientras dure la pestaña. */
const CLAVE_EQUIPAJE = "mjbj-asistente-equipaje";

/** Lo guardado, si lo hay y se puede leer. */
function leerGuardado(): EquipajeDelAsistente | null {
  try {
    const crudo = sessionStorage.getItem(CLAVE_EQUIPAJE);
    return crudo ? (JSON.parse(crudo) as EquipajeDelAsistente) : null;
  } catch {
    return null;
  }
}

/** Un renglón de la conversación. */
type Renglon =
  | { tipo: "asistente"; texto: string }
  | { tipo: "persona"; texto: string }
  | { tipo: "productos"; items: ProductoDelAsistente[] }
  | { tipo: "datos"; items: DatoDelAsistente[] }
  | { tipo: "vacio"; texto: string };

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
 *
 * **Cerrado no dibuja nada** (hallazgo 27, 18/11/2026). Era un círculo
 * naranja flotante al lado del WhatsApp: no decía qué era y en la ficha tapaba
 * el botón principal. Ahora lo abren la barra de escritorio, el buscador del
 * catálogo, el menú del celular y la página de «no existe», con
 * `abrirAsistente()`.
 *
 * Abierto es un diálogo: en el celular, una hoja desde abajo; desde `sm`, una
 * ventana en la esquina. El foco entra al campo, Tab no se escapa del panel,
 * Escape lo cierra y el foco vuelve a lo que lo abrió.
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

  /** Lo que dejó la última respuesta escrita a mano: botones y WhatsApp. */
  const [extra, setExtra] = useState<{
    sugerencias: { texto: string; va: string }[];
    aPersona: boolean;
    enlace?: { texto: string; href: string } | null;
  }>({ sugerencias: [], aPersona: false });
  /** Lo último que se buscó en el catálogo, para la pregunta que sigue. */
  const [ultimaConsulta, setUltimaConsulta] = useState<string | null>(null);
  /**
   * Lo último que la persona escribió: viaja en el mensaje de WhatsApp. Se
   * derivaba con «quería consultar por...» y había que volver a escribirlo
   * (mes simulado, M2S1-105).
   */
  const [ultimoEscrito, setUltimoEscrito] = useState<string | null>(null);

  const finRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const campoRef = useRef<HTMLInputElement>(null);
  /** Lo que tenía el foco al abrir, para devolvérselo al cerrar. */
  const origenRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const abrir = () => {
      origenRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setAbierto(true);
    };
    document.addEventListener(EVENTO_ABRIR_ASISTENTE, abrir);
    return () => document.removeEventListener(EVENTO_ABRIR_ASISTENTE, abrir);
  }, []);

  function cerrar() {
    setAbierto(false);
    // El menú del celular se cierra al abrir el asistente: si lo que lo abrió
    // ya no está en la página, el foco va al contenido y no al vacío.
    const origen = origenRef.current;
    if (origen?.isConnected) origen.focus();
    else document.getElementById("contenido")?.focus();
  }

  useEffect(() => {
    if (!abierto) return;
    campoRef.current?.focus();

    function teclado(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        cerrar();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      // El foco queda adentro: lo de atrás no se ve (en el celular la hoja lo
      // tapa) y tabular hacia allá es perderse.
      const enfocables = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (enfocables.length === 0) return;
      const primero = enfocables[0];
      const ultimo = enfocables[enfocables.length - 1];
      if (e.shiftKey && document.activeElement === primero) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    }
    document.addEventListener("keydown", teclado);
    return () => document.removeEventListener("keydown", teclado);
  }, [abierto]);

  /*
   * Una sola llamada, y solo al abrir.
   *
   * Trae los rubros, los horarios, las zonas de envío y las formas de pago:
   * todo lo que es igual para cualquiera. Con eso adentro, esas preguntas se
   * contestan en el navegador y no vuelven a molestar al servidor. Quien nunca
   * abre el panel no cuesta ni esta llamada.
   *
   * **Va por `fetch` y no por acción de servidor**, y esa es toda la diferencia
   * de costo: como acción viajaba por POST —que no se cachea nunca— y cada
   * persona que abría el panel pagaba una invocación de función. Como GET, el
   * primero la paga y el resto se sirve del CDN. Además queda en
   * `sessionStorage`: en la misma pestaña no se vuelve a pedir ni una vez.
   */
  useEffect(() => {
    if (!abierto || equipaje) return;

    let vigente = true;

    void (async () => {
      const guardado = leerGuardado();

      if (guardado) {
        if (vigente) setEquipaje(guardado);
        return;
      }

      try {
        const respuesta = await fetch("/api/asistente/equipaje");
        if (!respuesta.ok) return;

        const datos = (await respuesta.json()) as EquipajeDelAsistente;
        if (!vigente) return;

        setEquipaje(datos);

        try {
          sessionStorage.setItem(CLAVE_EQUIPAJE, JSON.stringify(datos));
        } catch {
          // Sin almacenamiento se vuelve a pedir la próxima vez que se abra.
        }
      } catch {
        // Sin equipaje el asistente sigue andando: le pregunta al servidor lo
        // que no puede contestar solo, que es como funcionaba antes.
      }
    })();

    return () => {
      vigente = false;
    };
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
    setExtra({ sugerencias: [], aPersona: false });

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
    const escrito = (consultaCruda ?? texto).trim();
    if (escrito.length < 1 || trabajando) return;

    decir([{ tipo: "persona", texto: escrito }]);
    setUltimoEscrito(escrito);
    setTexto("");
    setTrabajando(true);

    /*
     * Lo que se entendió lo dice el motor de Go, el mismo del bot de WhatsApp
     * (10/11/2026). Va la consulta anterior para «¿y en 18?» después de hablar
     * de MDF. La espera mínima es a propósito: aparecer instantáneo se siente
     * a formulario y no a conversación.
     */
    // Si el servidor no contesta, el panel no puede quedar trabado en los
    // tres puntitos: se ofrece una persona, como cuando no se entiende.
    const [respuesta] = await Promise.all([
      preguntarAlAsistente(escrito, ultimaConsulta).catch(
        (): RespuestaDelAsistente => ({
          texto: "Ahora no te puedo contestar. Te paso con alguien del mostrador.",
          aPersona: true,
        }),
      ),
      new Promise((listo) => setTimeout(listo, 400)),
    ]);

    setTrabajando(false);

    const nuevos: Renglon[] = [{ tipo: "asistente", texto: respuesta.texto }];

    const productos = respuesta.productos;
    if (productos?.length) {
      nuevos.push({ tipo: "productos", items: productos });
      if (respuesta.consulta) setUltimaConsulta(respuesta.consulta);
    }
    if (respuesta.datos?.length) {
      nuevos.push({ tipo: "datos", items: respuesta.datos });
    }

    decir(nuevos);
    setExtra({
      sugerencias: respuesta.sugerencias ?? [],
      aPersona: respuesta.aPersona ?? false,
      enlace: respuesta.enlace ?? null,
    });
  }

  const enRubros = paso.id === "rubros";
  const aWhatsapp = extra.aPersona || paso.accion?.tipo === "whatsapp";
  const irA = paso.accion?.tipo === "ir" ? paso.accion.ruta : null;

  // Los botones del guion, más los que dejó la última respuesta escrita. Uno
  // por destino: tras una búsqueda, «Hablar con alguien» de la respuesta y
  // «Quiero hablar con alguien» del inicio llevaban al mismo lado.
  const opciones = [...extra.sugerencias, ...paso.opciones].filter(
    (opcion, i, todas) => todas.findIndex((o) => o.va === opcion.va) === i,
  );

  if (!abierto) return null;

  return (
    <>
    {/* El fondo del celular: la hoja tapa casi toda la pantalla y lo de atrás
        no se usa mientras tanto. Tocarlo cierra, como en cualquier hoja. En
        oscuro, un 30 % de negro sobre la página oscura no se notaba y la hoja
        se fundía con lo de atrás. */}
    <div aria-hidden className="fixed inset-0 z-50 bg-black/30 dark:bg-black/60 sm:hidden" onClick={cerrar} />
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="asistente-titulo"
      className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col overflow-hidden rounded-t-2xl superficie pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_40px_-12px_rgb(60_50_40_/_0.45)] sm:inset-x-auto sm:right-6 sm:bottom-6 sm:max-h-[min(80vh,620px)] sm:w-[420px] sm:rounded-2xl sm:pb-0 sm:shadow-[0_24px_50px_-20px_rgb(60_50_40_/_0.45)]"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-linea px-4 py-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-naranja-claro">
          <PersonajeAsistente className="h-5 w-5 text-acento-texto" />
        </span>
        <div className="flex-1">
          <p id="asistente-titulo" className="font-semibold leading-tight">{ETIQUETA_ASISTENTE}</p>
          <p className="text-sm text-texto-3">Maderera Juan B. Justo</p>
        </div>
        <button
          type="button"
          onClick={cerrar}
          aria-label="Cerrar el asistente"
          className="flex h-10 w-10 items-center justify-center rounded-lg transition-colors hover:bg-sitio-alt"
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
              ref={campoRef}
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

        {extra.enlace && (
          <Button
            render={<Link href={extra.enlace.href} />}
            className="w-full bg-accion text-white hover:bg-accion-hover"
          >
            {extra.enlace.texto}
            <ArrowRight className="h-4 w-4" />
          </Button>
        )}

        {aWhatsapp && (
          <BotonWhatsapp
            enlace={
              ultimoEscrito
                ? `${enlaceWhatsapp.split("?")[0]}?text=${encodeURIComponent(mensajeDesdeElAsistente(ultimoEscrito))}`
                : enlaceWhatsapp
            }
            className="w-full"
          >
            Escribir por WhatsApp
          </BotonWhatsapp>
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
    </>
  );
}

function Renglon({ renglon }: { renglon: Renglon }) {
  const tienda = useTienda();
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
              <MuestraDePlaca categoria={p.categoriaSlug} className="h-12 w-12 shrink-0 rounded-lg" />
            )}

            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium">
                {p.nombre}
              </span>
              <span className="block text-sm text-texto-3">
                {p.medida ?? p.categoria}
              </span>
            </span>

            {/* Sin tienda no hay precio que mostrar, y sin stock cargado
                todo diría «a pedido». */}
            {(tienda.activa || tienda.stockVisible) && (
              <span className="shrink-0 text-right">
                {tienda.activa && (
                  <span className="block text-[15px] font-semibold">
                    {formatearPrecio(p.precioDesde)}
                  </span>
                )}
                {tienda.stockVisible && !p.hayStock && (
                  <span className="block text-xs text-texto-3">a pedido</span>
                )}
              </span>
            )}
          </Link>

          {/* Se puede sumar al presupuesto sin salir de la conversación. Es la
              diferencia entre un asistente que informa y uno que sirve para
              algo: la persona ya dijo qué necesita, hacerla navegar hasta la
              ficha para tocar otro botón es perderla en el camino. */}
          {tienda.activa && <AgregarAlPresupuesto producto={p} />}
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
      aria-label={`Agregar ${producto.nombre} al carrito`}
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
