import { api, ErrorApi, type Accion, type Carpeta, type Mensaje, type Resumen } from "./api";

// El estado de la bandeja, en un solo lugar. La dirección del navegador es
// la fuente de verdad de qué carpeta y qué mensaje se ven: así el botón de
// atrás del teléfono hace lo que uno espera, y un enlace a un mensaje abre
// ese mensaje.
//
//   /c/<carpeta>            la lista
//   /c/<carpeta>/<uid>      un mensaje abierto
//   ?q=texto                buscando en esa carpeta

export type ModoRedactar = "nuevo" | "responder" | "responder-todos" | "reenviar";

export interface Redaccion {
  modo: ModoRedactar;
  base?: Mensaje;
  carpeta?: string;
}

export interface Aviso {
  id: number;
  texto: string;
  deshacer?: () => void;
  error?: boolean;
}

// Lo que se demora una acción que se puede deshacer antes de mandarse.
const ESPERA_DESHACER = 5000;

function leerRuta(): { carpeta: string; uid: number | null; q: string } {
  const partes = location.pathname.split("/").filter(Boolean);
  const q = new URLSearchParams(location.search).get("q") ?? "";
  if (partes[0] !== "c" || !partes[1]) return { carpeta: "INBOX", uid: null, q };
  const uid = Number(partes[2]);
  return { carpeta: decodeURIComponent(partes[1]), uid: Number.isInteger(uid) && uid > 0 ? uid : null, q };
}

function armarRuta(carpeta: string, uid: number | null, q: string): string {
  let r = `/c/${encodeURIComponent(carpeta)}`;
  if (uid) r += `/${uid}`;
  if (q) r += `?${new URLSearchParams({ q })}`;
  return r;
}

class Bandeja {
  correo = $state<string | null>(null);
  carpetas = $state<Carpeta[]>([]);
  carpeta = $state("INBOX");
  q = $state("");
  mensajes = $state<Resumen[]>([]);
  total = $state(0);
  pagina = $state(1);
  paginas = $state(1);
  cargando = $state(false);
  error = $state<string | null>(null);

  /** El mensaje con el foco del teclado en la lista. */
  foco = $state<number | null>(null);
  /** Los marcados con la casilla, para las acciones en lote. */
  marcados = $state<Set<number>>(new Set());

  uidAbierto = $state<number | null>(null);
  abierto = $state<Mensaje | null>(null);
  cargandoMensaje = $state(false);

  redaccion = $state<Redaccion | null>(null);
  avisos = $state<Aviso[]>([]);
  menuAbierto = $state(false);

  // Los uid ocultos mientras su acción espera el «deshacer».
  #ocultos = $state<Set<number>>(new Set());
  #idAviso = 0;
  #pedidoLista = 0;
  // Si el mensaje abierto se abrió desde la lista (y no por un enlace).
  #desdeLista = false;

  visibles = $derived(this.mensajes.filter((m) => !this.#ocultos.has(m.uid)));
  carpetaActual = $derived(this.carpetas.find((c) => c.ruta === this.carpeta));
  rolActual = $derived(this.carpetaActual?.rol ?? "");

  constructor() {
    addEventListener("popstate", () => this.#desdeRuta());
  }

  async iniciar() {
    this.#desdeRuta(false);
    // La raíz es la entrada: se escribe en la dirección para que «atrás»
    // desde un mensaje vuelva a una ruta con carpeta.
    if (!location.pathname.startsWith("/c/")) history.replaceState(null, "", armarRuta(this.carpeta, this.uidAbierto, this.q));
    await Promise.all([this.cargarCarpetas(), this.cargarLista()]);
    if (this.uidAbierto) void this.#traerMensaje(this.uidAbierto);
  }

  #desdeRuta(cargar = true) {
    const r = leerRuta();
    const cambioLista = r.carpeta !== this.carpeta || r.q !== this.q;
    this.carpeta = r.carpeta;
    this.q = r.q;
    this.uidAbierto = r.uid;
    if (!r.uid) {
      this.abierto = null;
      this.#desdeLista = false;
    }
    if (!cargar) return;
    if (cambioLista) void this.cargarLista();
    if (r.uid && this.abierto?.uid !== r.uid) void this.#traerMensaje(r.uid);
  }

  #ir(carpeta: string, uid: number | null, q: string, reemplazar = false) {
    const ruta = armarRuta(carpeta, uid, q);
    if (ruta === location.pathname + location.search) return;
    if (reemplazar) history.replaceState(null, "", ruta);
    else history.pushState(null, "", ruta);
    this.#desdeRuta();
  }

  irACarpeta(ruta: string) {
    this.marcados = new Set();
    this.foco = null;
    this.menuAbierto = false;
    this.pagina = 1;
    this.#ir(ruta, null, "");
  }

  buscar(q: string) {
    this.#ir(this.carpeta, null, q.trim(), true);
  }

  abrir(uid: number) {
    this.foco = uid;
    // Pasar de un mensaje a otro con j/k no apila historia: «atrás» vuelve
    // a la lista, no al mensaje anterior.
    const yaAbierto = this.uidAbierto !== null;
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
      this.#falla(e);
    }
  }

  async cargarLista(pagina = this.pagina) {
    const pedido = ++this.#pedidoLista;
    this.cargando = true;
    this.error = null;
    try {
      const p = await api.lista(this.carpeta, pagina, this.q);
      if (pedido !== this.#pedidoLista) return; // llegó tarde: ya se pidió otra
      this.mensajes = p.mensajes;
      this.total = p.total;
      this.pagina = p.pagina;
      this.paginas = p.paginas;
      if (this.foco && !p.mensajes.some((m) => m.uid === this.foco)) this.foco = null;
    } catch (e) {
      if (pedido === this.#pedidoLista) this.error = e instanceof ErrorApi ? e.message : "No se pudo cargar.";
    } finally {
      if (pedido === this.#pedidoLista) this.cargando = false;
    }
  }

  /** Para el refresco de fondo: lista y contadores, sin parpadeo. */
  async refrescar() {
    if (this.cargando || document.hidden) return;
    await Promise.all([this.cargarCarpetas(), this.cargarLista()]);
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
    const siguiente = lista.slice(ultimo + 1).find((m) => !uids.includes(m.uid)) ??
      lista.slice(0, Math.max(ultimo, 0)).reverse().find((m) => !uids.includes(m.uid));
    this.#ocultos = new Set([...this.#ocultos, ...uids]);
    this.marcados = new Set();
    if (this.uidAbierto && uids.includes(this.uidAbierto)) this.cerrar();
    this.foco = siguiente?.uid ?? null;

    const borrarParaSiempre = accion === "papelera" && this.rolActual === "papelera";
    const n = uids.length;
    const textos: Partial<Record<Accion, string>> = {
      archivar: n === 1 ? "Archivado" : `${n} archivados`,
      papelera: borrarParaSiempre ? (n === 1 ? "Borrado para siempre" : `${n} borrados para siempre`) : n === 1 ? "En la papelera" : `${n} a la papelera`,
      spam: n === 1 ? "Marcado como spam" : `${n} marcados como spam`,
      restaurar: n === 1 ? "Devuelto a la entrada" : `${n} devueltos a la entrada`,
      mover: n === 1 ? "Movido" : `${n} movidos`,
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

  redactar(modo: ModoRedactar = "nuevo", base?: Mensaje) {
    this.redaccion = { modo, base, carpeta: this.carpeta };
  }
}

export const bandeja = new Bandeja();
