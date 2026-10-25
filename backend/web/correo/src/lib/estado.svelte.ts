import { api, ErrorApi, type Accion, type Carpeta, type Filtro, type Mensaje, type Resumen } from "./api";

// El estado de la bandeja, en un solo lugar. La dirección del navegador es
// la fuente de verdad de qué carpeta y qué mensaje se ven: así el botón de
// atrás del teléfono hace lo que uno espera, y un enlace a un mensaje abre
// ese mensaje.
//
//   /c/<carpeta>            la lista
//   /c/<carpeta>/<uid>      un mensaje abierto
//   ?q=texto                buscando en esa carpeta
//   ?f=sin-leer             una pestaña que no es «Todos»

export type ModoRedactar = "nuevo" | "responder" | "responder-todos" | "reenviar";

/** Una ventana de redactar (abajo a la derecha) o la respuesta en línea. */
export interface Redaccion {
  id: number;
  modo: ModoRedactar;
  base?: Mensaje;
  carpeta?: string;
  minimizada?: boolean;
  /** Lo que muestra la pestaña minimizada: el asunto que se va escribiendo. */
  titulo?: string;
  /** Para: ya cargado (al escribirle a un cliente desde su ficha). */
  para?: string;
  /** Lo escrito, cuando la respuesta en línea pasa a una ventana. */
  texto?: string;
}

export type Pestana = "todos" | "sin-leer" | "sin-responder";

/** Los botones de la búsqueda (2c). */
export interface Chips {
  dias: number; // 0 = cualquier fecha
  adjuntos: boolean;
  de: string;
}

/** Un envío que no salió por falta de conexión: sale solo cuando vuelve. */
interface EnCola {
  datos: FormData;
  asunto: string;
}

export interface Aviso {
  id: number;
  texto: string;
  deshacer?: () => void;
  error?: boolean;
}

// Lo que se demora una acción que se puede deshacer antes de mandarse.
const ESPERA_DESHACER = 5000;
// «Esperan respuesta»: lo que llegó en las últimas dos semanas y no se
// contestó. Más atrás ya no espera nada.
const DIAS_ESPERAN = 14;
// Cada cuánto se vuelve a probar solo cuando el servidor no responde.
const REINTENTO = 30;

const pestanas: Pestana[] = ["todos", "sin-leer", "sin-responder"];

function leerRuta(): { carpeta: string; uid: number | null; q: string; f: Pestana } {
  const partes = location.pathname.split("/").filter(Boolean);
  const busqueda = new URLSearchParams(location.search);
  const q = busqueda.get("q") ?? "";
  const pedida = busqueda.get("f") ?? "";
  const f = (pestanas as string[]).includes(pedida) ? (pedida as Pestana) : "todos";
  if (partes[0] !== "c" || !partes[1]) return { carpeta: "INBOX", uid: null, q, f };
  const uid = Number(partes[2]);
  return { carpeta: decodeURIComponent(partes[1]), uid: Number.isInteger(uid) && uid > 0 ? uid : null, q, f };
}

function armarRuta(carpeta: string, uid: number | null, q: string, f: Pestana): string {
  let r = `/c/${encodeURIComponent(carpeta)}`;
  if (uid) r += `/${uid}`;
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (f !== "todos") p.set("f", f);
  if (p.size) r += `?${p}`;
  return r;
}

class Bandeja {
  correo = $state<string | null>(null);
  carpetas = $state<Carpeta[]>([]);
  carpeta = $state("INBOX");
  q = $state("");
  pestana = $state<Pestana>("todos");
  chips = $state<Chips>({ dias: 0, adjuntos: false, de: "" });
  mensajes = $state<Resumen[]>([]);
  total = $state(0);
  pagina = $state(1);
  paginas = $state(1);
  cargando = $state(false);
  error = $state<string | null>(null);
  /** Segundos que faltan para el reintento solo, cuando hay error. */
  reintentoEn = $state(0);
  /** El navegador dice que no hay red, o un pedido no llegó a ningún lado. */
  sinConexion = $state(!navigator.onLine);
  cola = $state<EnCola[]>([]);
  /** Si ya llegó la lista de esta carpeta: los esqueletos van solo antes. */
  listaLista = $state(false);

  /** El mensaje con el foco del teclado en la lista. */
  foco = $state<number | null>(null);
  /** Los marcados con la casilla, para las acciones en lote. */
  marcados = $state<Set<number>>(new Set());

  uidAbierto = $state<number | null>(null);
  abierto = $state<Mensaje | null>(null);
  cargandoMensaje = $state(false);

  /** Las ventanas de redactar; la que no está minimizada es la de adelante. */
  ventanas = $state<Redaccion[]>([]);
  /** Responder o reenviar debajo del mensaje abierto. */
  enLinea = $state<Redaccion | null>(null);
  avisos = $state<Aviso[]>([]);
  menuAbierto = $state(false);
  ajustesAbiertos = $state(false);

  // Los uid ocultos mientras su acción espera el «deshacer».
  #ocultos = $state<Set<number>>(new Set());
  #idAviso = 0;
  #idRedaccion = 0;
  #pedidoLista = 0;
  #reloj: ReturnType<typeof setInterval> | undefined;
  // Si el mensaje abierto se abrió desde la lista (y no por un enlace).
  #desdeLista = false;

  visibles = $derived(this.mensajes.filter((m) => !this.#ocultos.has(m.uid)));
  carpetaActual = $derived(this.carpetas.find((c) => c.ruta === this.carpeta));
  rolActual = $derived(this.carpetaActual?.rol ?? "");

  /** Lo que se le pide al servidor: la búsqueda, la pestaña y los botones. */
  filtro = $derived.by((): Filtro => {
    const f: Filtro = { q: this.q };
    if (this.pestana === "sin-leer") f.filtro = "sin-leer";
    if (this.pestana === "sin-responder") {
      f.filtro = "sin-responder";
      f.dias = DIAS_ESPERAN;
    }
    if (this.q) {
      if (this.chips.dias) f.dias = this.chips.dias;
      if (this.chips.adjuntos) f.adjuntos = true;
      if (this.chips.de) f.de = this.chips.de;
    }
    return f;
  });

  constructor() {
    addEventListener("popstate", () => this.#desdeRuta());
    addEventListener("offline", () => (this.sinConexion = true));
    addEventListener("online", () => {
      this.sinConexion = false;
      void this.#vaciarCola();
      void this.refrescar(true);
    });
  }

  async iniciar() {
    this.#desdeRuta(false);
    // La raíz es la entrada: se escribe en la dirección para que «atrás»
    // desde un mensaje vuelva a una ruta con carpeta.
    if (!location.pathname.startsWith("/c/"))
      history.replaceState(null, "", armarRuta(this.carpeta, this.uidAbierto, this.q, this.pestana));
    await Promise.all([this.cargarCarpetas(), this.cargarLista()]);
    if (this.uidAbierto) void this.#traerMensaje(this.uidAbierto);
  }

  #desdeRuta(cargar = true) {
    const r = leerRuta();
    const cambioCarpeta = r.carpeta !== this.carpeta;
    const cambioLista = cambioCarpeta || r.q !== this.q || r.f !== this.pestana;
    if (cambioCarpeta) this.listaLista = false;
    this.carpeta = r.carpeta;
    this.q = r.q;
    this.pestana = r.f;
    this.uidAbierto = r.uid;
    if (!r.uid) {
      this.abierto = null;
      this.enLinea = null;
      this.#desdeLista = false;
    }
    if (!cargar) return;
    if (cambioLista) void this.cargarLista(1);
    if (r.uid && this.abierto?.uid !== r.uid) void this.#traerMensaje(r.uid);
  }

  #ir(carpeta: string, uid: number | null, q: string, reemplazar = false, f = this.pestana) {
    const ruta = armarRuta(carpeta, uid, q, f);
    if (ruta === location.pathname + location.search) return;
    if (reemplazar) history.replaceState(null, "", ruta);
    else history.pushState(null, "", ruta);
    this.#desdeRuta();
  }

  irACarpeta(ruta: string) {
    this.marcados = new Set();
    this.foco = null;
    this.menuAbierto = false;
    this.ajustesAbiertos = false;
    this.pagina = 1;
    this.enLinea = null;
    this.#ir(ruta, null, "", false, "todos");
  }

  buscar(q: string) {
    this.#ir(this.carpeta, null, q.trim(), true);
  }

  elegirPestana(p: Pestana) {
    this.marcados = new Set();
    this.pagina = 1;
    this.#ir(this.carpeta, null, this.q, true, p);
  }

  /** Cambia un botón de la búsqueda y vuelve a pedir. */
  ponerChips(c: Partial<Chips>) {
    this.chips = { ...this.chips, ...c };
    if (this.q) void this.cargarLista(1);
  }

  abrir(uid: number) {
    this.foco = uid;
    // Pasar de un mensaje a otro con j/k no apila historia: «atrás» vuelve
    // a la lista, no al mensaje anterior.
    const yaAbierto = this.uidAbierto !== null;
    if (this.enLinea && this.enLinea.base?.uid !== uid) this.enLinea = null;
    this.#ir(this.carpeta, uid, this.q, yaAbierto);
    if (!yaAbierto) this.#desdeLista = true;
  }

  cerrar() {
    if (!this.uidAbierto) return;
    // Si se llegó al mensaje desde la lista, «atrás» deja la lista donde
    // estaba; si se entró directo por el enlace, se reemplaza.
    if (this.#desdeLista) history.back();
    else this.#ir(this.carpeta, null, this.q, true);
    this.#desdeLista = false;
  }

  async cargarCarpetas() {
    try {
      this.carpetas = await api.carpetas();
    } catch (e) {
      // Sin conexión se sigue con las carpetas que ya estaban.
      if (!(e instanceof ErrorApi && e.estado === 0)) this.#falla(e);
    }
  }

  async cargarLista(pagina = this.pagina) {
    const pedido = ++this.#pedidoLista;
    this.cargando = true;
    try {
      const p = await api.lista(this.carpeta, pagina, this.filtro);
      if (pedido !== this.#pedidoLista) return; // llegó tarde: ya se pidió otra
      this.mensajes = p.mensajes;
      this.total = p.total;
      this.pagina = p.pagina;
      this.paginas = p.paginas;
      this.error = null;
      this.sinConexion = false;
      this.listaLista = true;
      this.#pararReintento();
      if (this.foco && !p.mensajes.some((m) => m.uid === this.foco)) this.foco = null;
    } catch (e) {
      if (pedido !== this.#pedidoLista) return;
      if (e instanceof ErrorApi && e.estado === 0) {
        // Sin red: se sigue leyendo lo que ya estaba, con la franja arriba.
        this.sinConexion = true;
        if (!this.listaLista) this.error = e.message;
      } else if (!(e instanceof ErrorApi && e.estado === 401)) {
        this.error = e instanceof ErrorApi ? e.message : "No se pudo cargar.";
        this.#programarReintento();
      }
    } finally {
      if (pedido === this.#pedidoLista) this.cargando = false;
    }
  }

  #programarReintento() {
    this.#pararReintento();
    this.reintentoEn = REINTENTO;
    this.#reloj = setInterval(() => {
      this.reintentoEn--;
      if (this.reintentoEn <= 0) {
        this.#pararReintento();
        void this.refrescar(true);
      }
    }, 1000);
  }

  #pararReintento() {
    clearInterval(this.#reloj);
    this.reintentoEn = 0;
  }

  /** Para el refresco de fondo: lista y contadores, sin parpadeo. */
  async refrescar(forzar = false) {
    if (!forzar && (this.cargando || document.hidden)) return;
    await Promise.all([this.cargarCarpetas(), this.cargarLista()]);
  }

  /**
   * Manda un correo. Sin conexión queda en la cola y sale solo cuando
   * vuelve, que es lo que promete la franja de arriba.
   */
  async enviar(datos: FormData, asunto: string): Promise<"enviado" | "en-cola"> {
    try {
      await api.enviar(datos);
      void this.refrescar(true);
      return "enviado";
    } catch (e) {
      if (e instanceof ErrorApi && e.estado === 0) {
        this.sinConexion = true;
        this.cola = [...this.cola, { datos, asunto }];
        return "en-cola";
      }
      throw e;
    }
  }

  async reintentarCola() {
    await this.#vaciarCola();
    await this.refrescar(true);
  }

  async #vaciarCola() {
    const pendientes = this.cola;
    this.cola = [];
    for (const p of pendientes) {
      try {
        await api.enviar(p.datos);
        this.avisar(`Salió «${p.asunto || "(sin asunto)"}»`);
      } catch (e) {
        if (e instanceof ErrorApi && e.estado === 0) this.cola = [...this.cola, p];
        else this.avisar(`No salió «${p.asunto || "(sin asunto)"}»: ${e instanceof Error ? e.message : "falló"}`, undefined, true);
      }
    }
  }

  async #traerMensaje(uid: number) {
    this.cargandoMensaje = true;
    try {
      const m = await api.mensaje(this.carpeta, uid);
      if (this.uidAbierto !== uid) return;
      this.abierto = m;
      // Abrirlo lo marcó leído en el servidor: lo reflejo sin recargar.
      const fila = this.mensajes.find((x) => x.uid === uid);
      if (fila && !fila.leido) {
        fila.leido = true;
        const c = this.carpetaActual;
        if (c && c.noLeidos > 0) c.noLeidos--;
      }
    } catch (e) {
      this.#falla(e);
      if (e instanceof ErrorApi && e.estado === 404) this.cerrar();
    } finally {
      this.cargandoMensaje = false;
    }
  }

  /** Los uid sobre los que actúa una acción: los marcados, o el abierto, o el del foco. */
  objetivo(): number[] {
    if (this.marcados.size) return [...this.marcados];
    if (this.uidAbierto) return [this.uidAbierto];
    if (this.foco) return [this.foco];
    return [];
  }

  /** Pone o saca una etiqueta, al instante y sin deshacer (se saca igual que se puso). */
  async etiquetar(nombre: string, poner: boolean, uids = this.objetivo()) {
    if (!uids.length) return;
    const cambiar = (lista: string[]) => (poner ? [...new Set([...lista, nombre])] : lista.filter((e) => e !== nombre));
    for (const m of this.mensajes) if (uids.includes(m.uid)) m.etiquetas = cambiar(m.etiquetas);
    if (this.abierto && uids.includes(this.abierto.uid)) this.abierto.etiquetas = cambiar(this.abierto.etiquetas ?? []);
    try {
      await api.acciones(this.carpeta, uids, poner ? "etiquetar" : "desetiquetar", nombre);
    } catch (e) {
      this.#falla(e);
      void this.cargarLista();
    }
  }

  /**
   * Las marcas (leído, destacado) se aplican al instante. Lo que saca el
   * mensaje de la carpeta (archivar, papelera, spam, mover) espera cinco
   * segundos con un «Deshacer» a mano antes de mandarse: así no hace falta
   * deshacer en el servidor, que es lo frágil.
   */
  async accion(accion: Accion, uids = this.objetivo(), destino?: string) {
    if (!uids.length) return;
    const carpeta = this.carpeta;
    const marcas: Partial<Record<Accion, [keyof Resumen, boolean]>> = {
      leido: ["leido", true],
      "no-leido": ["leido", false],
      destacar: ["destacado", true],
      "no-destacar": ["destacado", false],
    };
    const marca = marcas[accion];
    if (marca) {
      const [campo, valor] = marca;
      for (const m of this.mensajes) if (uids.includes(m.uid)) (m as unknown as Record<string, boolean>)[campo] = valor;
      if (this.abierto && uids.includes(this.abierto.uid)) (this.abierto as unknown as Record<string, boolean>)[campo] = valor;
      try {
        await api.acciones(carpeta, uids, accion);
        if (campo === "leido") void this.cargarCarpetas();
      } catch (e) {
        this.#falla(e);
        void this.cargarLista();
      }
      return;
    }

    // Se va de la carpeta: el foco pasa al siguiente, como en cualquier programa.
    const lista = this.visibles;
    const ultimo = lista.findIndex((m) => m.uid === uids[uids.length - 1]);
    const siguiente =
      lista.slice(ultimo + 1).find((m) => !uids.includes(m.uid)) ??
      lista
        .slice(0, Math.max(ultimo, 0))
        .reverse()
        .find((m) => !uids.includes(m.uid));
    this.#ocultos = new Set([...this.#ocultos, ...uids]);
    this.marcados = new Set();
    if (this.uidAbierto && uids.includes(this.uidAbierto)) this.cerrar();
    this.foco = siguiente?.uid ?? null;

    const borrarParaSiempre = accion === "papelera" && this.rolActual === "papelera";
    const n = uids.length;
    const nombreDestino = this.carpetas.find((c) => c.ruta === destino)?.nombre ?? destino;
    const textos: Partial<Record<Accion, string>> = {
      archivar: n === 1 ? "Archivado" : `${n} archivados`,
      papelera: borrarParaSiempre
        ? n === 1
          ? "Borrado para siempre"
          : `${n} borrados para siempre`
        : n === 1
          ? "En la papelera"
          : `${n} a la papelera`,
      spam: n === 1 ? "Marcado como spam" : `${n} marcados como spam`,
      restaurar: n === 1 ? "Devuelto a la entrada" : `${n} devueltos a la entrada`,
      mover: n === 1 ? `Movido a ${nombreDestino}` : `${n} movidos a ${nombreDestino}`,
    };
    let cancelado = false;
    const mandar = async () => {
      if (cancelado) return;
      try {
        await api.acciones(carpeta, uids, accion, destino);
      } catch (e) {
        this.#falla(e);
      } finally {
        this.#ocultos = new Set([...this.#ocultos].filter((u) => !uids.includes(u)));
        await Promise.all([this.cargarLista(), this.cargarCarpetas()]);
      }
    };
    const temporizador = setTimeout(mandar, ESPERA_DESHACER);
    // Si se cierra la pestaña antes, la acción se manda igual.
    const alSalir = () => {
      clearTimeout(temporizador);
      navigator.sendBeacon?.(
        `/api/carpetas/${encodeURIComponent(carpeta)}/acciones`,
        new Blob([JSON.stringify({ uids, accion, destino })], { type: "application/json" }),
      );
    };
    addEventListener("pagehide", alSalir, { once: true });
    this.avisar(textos[accion] ?? "Listo", () => {
      cancelado = true;
      clearTimeout(temporizador);
      removeEventListener("pagehide", alSalir);
      this.#ocultos = new Set([...this.#ocultos].filter((u) => !uids.includes(u)));
    });
    setTimeout(() => removeEventListener("pagehide", alSalir), ESPERA_DESHACER + 100);
  }

  avisar(texto: string, deshacer?: () => void, error = false) {
    const id = ++this.#idAviso;
    this.avisos = [...this.avisos, { id, texto, deshacer, error }];
    setTimeout(() => this.quitarAviso(id), deshacer ? ESPERA_DESHACER : error ? 8000 : 3500);
  }

  quitarAviso(id: number) {
    this.avisos = this.avisos.filter((a) => a.id !== id);
  }

  #falla(e: unknown) {
    if (e instanceof ErrorApi && e.estado === 401) return; // la App ya vuelve a la entrada
    if (e instanceof ErrorApi && e.estado === 0) {
      this.sinConexion = true;
      return; // la franja de arriba ya lo dice
    }
    this.avisar(e instanceof Error ? e.message : "Algo falló.", undefined, true);
  }

  marcar(uid: number) {
    const s = new Set(this.marcados);
    if (s.has(uid)) s.delete(uid);
    else s.add(uid);
    this.marcados = s;
  }

  marcarTodos() {
    this.marcados = this.marcados.size === this.visibles.length ? new Set() : new Set(this.visibles.map((m) => m.uid));
  }

  moverFoco(delta: number) {
    const lista = this.visibles;
    if (!lista.length) return;
    const i = lista.findIndex((m) => m.uid === this.foco);
    const j = i < 0 ? 0 : Math.min(Math.max(i + delta, 0), lista.length - 1);
    this.foco = lista[j].uid;
    if (this.uidAbierto) this.abrir(lista[j].uid);
  }

  /** Una ventana nueva de redactar. Las otras quedan minimizadas. */
  redactar(modo: ModoRedactar = "nuevo", base?: Mensaje, para?: string) {
    const id = ++this.#idRedaccion;
    this.ventanas = [
      ...this.ventanas.map((v) => ({ ...v, minimizada: true })),
      { id, modo, base, carpeta: this.carpeta, para, titulo: modo === "nuevo" ? "Mensaje nuevo" : base?.asunto },
    ];
  }

  /** Responder o reenviar ahí mismo, debajo del mensaje (2k, 2l). */
  responderEnLinea(modo: ModoRedactar, base: Mensaje) {
    this.enLinea = { id: ++this.#idRedaccion, modo, base, carpeta: this.carpeta };
  }

  /** Pasa la respuesta en línea a una ventana, con lo escrito. */
  agrandar(r: Redaccion) {
    this.enLinea = null;
    this.ventanas = [...this.ventanas.map((v) => ({ ...v, minimizada: true })), { ...r, minimizada: false }];
  }

  cerrarVentana(id: number) {
    this.ventanas = this.ventanas.filter((v) => v.id !== id);
    if (this.enLinea?.id === id) this.enLinea = null;
  }

  /** Minimiza o trae adelante una ventana; solo una queda abierta. */
  alternarVentana(id: number) {
    this.ventanas = this.ventanas.map((v) =>
      v.id === id ? { ...v, minimizada: !v.minimizada } : { ...v, minimizada: true },
    );
  }

  titularVentana(id: number, titulo: string) {
    const v = this.ventanas.find((x) => x.id === id);
    if (v && v.titulo !== titulo) v.titulo = titulo;
  }
}

export const bandeja = new Bandeja();
