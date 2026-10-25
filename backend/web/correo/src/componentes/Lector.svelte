<script lang="ts">
  import { api, type Adjunto } from "../lib/api";
  import { bandeja } from "../lib/estado.svelte";
  import { clientes, type Ficha } from "../lib/clientes.svelte";
  import { familiaDe } from "../lib/etiquetas";
  import { cuantos, fechaDelMensaje, iniciales, nombreDe, tamano, tipoDeAdjunto } from "../lib/formato";
  import Icono from "./Icono.svelte";
  import MenuMas from "./MenuMas.svelte";
  import Descargas from "./Descargas.svelte";
  import FichaCliente from "./FichaCliente.svelte";
  import EnLinea from "./EnLinea.svelte";
  import Visor from "./Visor.svelte";
  import Conversacion from "./Conversacion.svelte";
  import { equipo } from "../lib/equipo.svelte";

  // Por remitente: si alguien permitió las imágenes de un remitente, las
  // siguientes de ese mismo se ven solas.
  const CLAVE_CONFIABLES = "correo:imagenes-de";
  function confiables(): Set<string> {
    try {
      return new Set(JSON.parse(localStorage.getItem(CLAVE_CONFIABLES) ?? "[]"));
    } catch {
      return new Set();
    }
  }
  let verImagenes = $state(false);
  let menuMas = $state(false);
  let descargas = $state(false);
  let visor = $state<number | null>(null);
  let ficha = $state<Ficha | null>(null);

  const m = $derived(bandeja.abierto);
  const remitente = $derived(m?.de[0]?.correo ?? "");
  $effect(() => {
    verImagenes = !!remitente && confiables().has(remitente);
    menuMas = false;
    descargas = false;
    visor = null;
  });

  // La ficha del cliente: solo si el remitente lo es (y la casilla puede verla).
  $effect(() => {
    const c = remitente;
    ficha = null;
    if (!c || bandeja.rolActual === "enviados") return;
    void clientes.ficha(c).then((f) => {
      if (remitente === c) ficha = f;
    });
  });

  function permitirSiempre() {
    const s = confiables();
    s.add(remitente);
    try {
      localStorage.setItem(CLAVE_CONFIABLES, JSON.stringify([...s].slice(-500)));
    } catch {
      // sin almacenamiento: vale por esta vez
    }
    verImagenes = true;
  }

  const enPapelera = $derived(bandeja.rolActual === "papelera" || bandeja.rolActual === "spam");

  // El texto plano con los enlaces clickeables y las citas («> ») atenuadas,
  // sin pasar nunca por innerHTML. Los párrafos se separan por línea vacía.
  type Trozo = { texto: string; enlace?: string };
  function trozos(linea: string): Trozo[] {
    const out: Trozo[] = [];
    const re = /\bhttps?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]]/g;
    let ultimo = 0;
    for (const coincidencia of linea.matchAll(re)) {
      const i = coincidencia.index ?? 0;
      if (i > ultimo) out.push({ texto: linea.slice(ultimo, i) });
      out.push({ texto: coincidencia[0], enlace: coincidencia[0] });
      ultimo = i + coincidencia[0].length;
    }
    if (ultimo < linea.length) out.push({ texto: linea.slice(ultimo) });
    return out;
  }
  const parrafos = $derived(
    (m?.texto ?? "")
      .split(/\n\s*\n/)
      .map((p) => p.replace(/^\n+|\n+$/g, ""))
      .filter(Boolean),
  );

  const archivos = $derived((m?.adjuntos ?? []).filter((a) => !a.enLinea));
  const pesoTotal = $derived(archivos.filter((a) => !a.bloqueado).reduce((s, a) => s + a.tamano, 0));
  const sePuedeVer = (a: Adjunto) => !a.bloqueado && /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(a.tipo);
  const visibles = $derived(archivos.filter(sePuedeVer));

  function ver(a: Adjunto) {
    if (!sePuedeVer(a)) return;
    visor = visibles.indexOf(a);
  }
</script>

<article class="lector" aria-label="Mensaje">
  {#if !bandeja.uidAbierto}
    <div class="nada">
      <img src="/logo.png" alt="" width="44" height="44" />
      <p>Elegí un correo para leerlo</p>
      <p class="pista"><span class="tecla">j</span> <span class="tecla">k</span> para moverse · <span class="tecla">?</span> todos los atajos</p>
    </div>
  {:else}
    <div class="columna">
      <div class="acciones" role="toolbar" aria-label="Acciones">
        <button class="icono volver" title="Volver (u)" aria-label="Volver" onclick={() => bandeja.cerrar()}><Icono nombre="atras" tamano={24} /></button>
        {#if m}
          <button class="accion siempre" onclick={() => bandeja.responderEnLinea("responder", m)} title="Responder (r)"><Icono nombre="responder" tamano={19} /><span>Responder</span></button>
          <button class="accion siempre" onclick={() => bandeja.responderEnLinea("reenviar", m)} title="Reenviar (f)"><Icono nombre="reenviar" tamano={19} /><span>Reenviar</span></button>
        {/if}
        {#if enPapelera || bandeja.rolActual === "archivo"}
          <button class="accion" onclick={() => bandeja.accion("restaurar")} title="Devolver a la entrada (e)"><Icono nombre="restaurar" tamano={19} /><span>A la entrada</span></button>
        {:else}
          <button class="accion" onclick={() => bandeja.accion("archivar")} title="Archivar (e)"><Icono nombre="archivo" tamano={19} /><span>Archivar</span></button>
        {/if}
        <button class="accion" onclick={() => bandeja.accion("papelera")} title={bandeja.rolActual === "papelera" ? "Borrar para siempre (#)" : "Borrar (#)"}>
          <Icono nombre="papelera" tamano={19} /><span>Borrar</span>
        </button>
        <span class="empuje"></span>
        {#if m}
          <div class="con-menu">
            <button class="icono" aria-label="Más acciones" aria-expanded={menuMas} onclick={(e) => (e.stopPropagation(), (menuMas = !menuMas))}><Icono nombre="mas" tamano={20} /></button>
            {#if menuMas}<MenuMas mensaje={m} oncerrar={() => (menuMas = false)} />{/if}
          </div>
        {/if}
      </div>

      {#if !m}
        <div class="leer cargando" aria-busy="true">
          <div class="esqueleto" style:height="20px" style:width="62%"></div>
          <div class="fila-esq"><span class="esqueleto redondo"></span><span class="lineas"><span class="esqueleto" style:height="12px" style:width="30%"></span><span class="esqueleto" style:height="10px" style:width="45%"></span></span></div>
          <div class="esqueleto" style:height="11px" style:width="92%"></div>
          <div class="esqueleto" style:height="11px" style:width="86%"></div>
          <div class="esqueleto" style:height="11px" style:width="70%"></div>
        </div>
      {:else}
        <div class="leer">
          <h1>{m.asunto || "(sin asunto)"}</h1>
          {#if m.etiquetas?.length}
            <div class="etiquetas">
              {#each m.etiquetas as e (e)}
                <span class="chip {familiaDe(e)} grande">
                  {e}
                  <button class="quitar" aria-label="Sacar la etiqueta {e}" onclick={() => bandeja.etiquetar(e, false, [m.uid])}><Icono nombre="cerrar" tamano={13} /></button>
                </span>
              {/each}
            </div>
          {/if}

          {#if m.sospecha}
            <div class="sospecha" role="alert">
              <Icono nombre="spam" tamano={20} />
              <div>
                <strong>Este correo puede ser una estafa</strong>
                <p>{m.sospecha.motivo} No toques los enlaces ni pases tu clave.</p>
                <div class="que-hago">
                  {#if bandeja.rolActual !== "spam"}<button class="enlace" onclick={() => bandeja.accion("spam")}>Mandar a Spam</button>{/if}
                  <button class="enlace suave" onclick={() => m && (m.sospecha = undefined)}>Es de confianza</button>
                </div>
              </div>
            </div>
          {/if}

          {#if ficha}
            <FichaCliente {ficha} compacta />
          {/if}

          <div class="de">
            <span class="avatar {ficha ? 'cliente' : clientes.tipo(remitente)}" style:width="48px" style:height="48px" style:font-size="18px">{iniciales(m.de[0])}</span>
            <div class="datos">
              <strong>{nombreDe(m.de[0])}</strong>
              <span class="direccion">
                {m.de[0]?.correo ?? ""} · para {m.para.map((d) => d.correo).join(", ") || "—"}{#if m.cc.length}, copia a {m.cc.map((d) => d.correo).join(", ")}{/if}
              </span>
              <span class="fecha-tel">{fechaDelMensaje(m.fecha)}</span>
            </div>
            <time datetime={m.fecha} title={new Date(m.fecha).toLocaleString("es-AR")}>{fechaDelMensaje(m.fecha)}</time>
            <button
              class="icono estrella"
              class:activa={m.destacado}
              aria-label={m.destacado ? "Quitar de destacados" : "Destacar"}
              title={m.destacado ? "Quitar de destacados (s)" : "Destacar (s)"}
              onclick={() => bandeja.accion(m.destacado ? "no-destacar" : "destacar")}
            >
              <Icono nombre="estrella" tamano={20} relleno={m.destacado} />
            </button>
          </div>

          {#if equipo.activo && bandeja.rolActual !== "enviados" && bandeja.rolActual !== "borradores"}
            <Conversacion mensaje={m} />
          {/if}

          {#if m.tieneHtml && m.imagenesRemotas && !verImagenes}
            <div class="aviso-imagenes">
              <Icono nombre="sin-imagenes" tamano={18} />
              <span>Las imágenes de este correo están ocultas.</span>
              <button class="enlace" onclick={() => (verImagenes = true)}>Mostrar imágenes</button>
              <button class="enlace suave" onclick={permitirSiempre} title="Mostrar siempre las de {remitente}">Siempre de este remitente</button>
            </div>
          {/if}

          {#if m.tieneHtml}
            {#key `${m.uid}-${verImagenes}`}
              <iframe
                title="Contenido del mensaje"
                src={api.urlHTML(bandeja.carpeta, m.uid, verImagenes)}
                sandbox="allow-popups allow-popups-to-escape-sandbox"
                referrerpolicy="no-referrer"
              ></iframe>
            {/key}
          {:else}
            <div class="texto">
              {#each parrafos as p, i (i)}
                <p class:cita={p.trimStart().startsWith(">")}>
                  {#each trozos(p) as t, j (j)}{#if t.enlace}<a href={t.enlace} target="_blank" rel="noopener noreferrer">{t.texto}</a>{:else}{t.texto}{/if}{/each}
                </p>
              {/each}
            </div>
          {/if}

          {#if archivos.length}
            <section class="adjuntos" aria-label="Adjuntos">
              <div class="resumen-adj">
                <Icono nombre="clip" tamano={18} />
                <strong>{cuantos(archivos.length, "adjunto", "adjuntos")}</strong>
                {#if pesoTotal}<span>{tamano(pesoTotal)}</span>{/if}
                {#if archivos.filter((a) => !a.bloqueado).length > 1}
                  <div class="con-menu derecha">
                    <button class="descargar-todo" class:abierto={descargas} onclick={(e) => (e.stopPropagation(), (descargas = !descargas))}>
                      <Icono nombre="descargar" tamano={17} />Descargar todo
                    </button>
                    {#if descargas}<Descargas mensaje={m} {archivos} {ficha} oncerrar={() => (descargas = false)} />{/if}
                  </div>
                {/if}
              </div>
              <ul class="tarjetas">
                {#each archivos as a (a.indice)}
                  {@const t = tipoDeAdjunto(a.tipo, a.nombre)}
                  <li class="tarjeta" class:bloqueado={a.bloqueado}>
                    {#if a.bloqueado}
                      <div class="pie bloqueado-pie">
                        <Icono nombre="candado" tamano={18} />
                        <div class="nombre-adj"><span>{a.nombre}</span><small>Bloqueado: es un programa, no un documento</small></div>
                      </div>
                    {:else}
                      <button class="vista-previa" onclick={() => ver(a)} aria-label={sePuedeVer(a) ? `Ver ${a.nombre}` : a.nombre} tabindex={sePuedeVer(a) ? 0 : -1}>
                        {#if a.tipo.startsWith("image/") && sePuedeVer(a)}
                          <img src={api.urlAdjunto(bandeja.carpeta, m.uid, a.indice, true)} alt="" loading="lazy" />
                        {:else}
                          <span class="rayado"><Icono nombre={t.icono} tamano={28} /></span>
                        {/if}
                        <span class="sobre">
                          {#if sePuedeVer(a)}<span class="pastilla"><Icono nombre="ver" tamano={16} />Ver</span>{/if}
                          <a
                            class="pastilla redonda"
                            href={api.urlAdjunto(bandeja.carpeta, m.uid, a.indice)}
                            download={a.nombre}
                            aria-label="Descargar {a.nombre}"
                            onclick={(e) => e.stopPropagation()}><Icono nombre="descargar" tamano={16} /></a
                          >
                        </span>
                      </button>
                      <div class="pie">
                        <span style:color={t.color} style:display="inline-flex"><Icono nombre={t.icono} tamano={20} /></span>
                        <div class="nombre-adj"><span title={a.nombre}>{a.nombre}</span><small>{t.clase} · {tamano(a.tamano)}</small></div>
                      </div>
                    {/if}
                  </li>
                {/each}
              </ul>
            </section>
          {/if}

          {#if bandeja.enLinea && bandeja.enLinea.base?.uid === m.uid}
            {#key bandeja.enLinea.id}
              <EnLinea redaccion={bandeja.enLinea} />
            {/key}
          {:else}
            <div class="responder">
              <button class="boton grande" onclick={() => bandeja.responderEnLinea("responder", m)}><Icono nombre="responder" tamano={20} />Responder</button>
              {#if m.para.length + m.cc.length > 1}
                <button class="boton grande" onclick={() => bandeja.responderEnLinea("responder-todos", m)}><Icono nombre="responder-todos" tamano={20} />A todos</button>
              {/if}
              <button class="boton grande" onclick={() => bandeja.responderEnLinea("reenviar", m)}><Icono nombre="reenviar" tamano={20} />Reenviar</button>
            </div>
          {/if}
        </div>
      {/if}
      {#if m}
        <div class="botonera-tel">
          <button class="boton principal grande" onclick={() => bandeja.responderEnLinea("responder", m)}><Icono nombre="responder" tamano={20} />Responder</button>
          <button class="boton grande" onclick={() => bandeja.responderEnLinea("reenviar", m)}><Icono nombre="reenviar" tamano={20} />Reenviar</button>
        </div>
      {/if}
    </div>
    {#if ficha && m}
      <FichaCliente {ficha} />
    {/if}
  {/if}
</article>

{#if visor !== null && m}
  <Visor mensaje={m} adjuntos={visibles} bind:indice={visor} {ficha} />
{/if}

<style>
  .lector {
    display: flex;
    min-width: 0;
    min-height: 0;
  }
  .columna {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .nada {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--mut);
    font-size: 15px;
    padding: 24px;
    text-align: center;
  }
  .nada img {
    border-radius: 10px;
    opacity: 0.35;
    filter: grayscale(1);
  }
  .nada p {
    margin: 0;
  }
  .pista {
    font-size: 14px;
  }
  .acciones {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 56px;
    flex: none;
    padding: 0 12px;
    border-bottom: 1px solid var(--ls);
  }
  .accion {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 42px;
    padding: 0 12px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    font-size: 16px;
    color: var(--fg);
  }
  .accion :global(svg) {
    color: var(--mut);
  }
  .accion:hover {
    background: var(--sel);
  }
  .volver {
    display: none;
  }
  .empuje {
    flex: 1;
  }
  .con-menu {
    position: relative;
  }
  .leer {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 24px 32px 32px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .leer.cargando {
    gap: 14px;
    padding-top: 28px;
  }
  .fila-esq {
    display: flex;
    gap: 12px;
    align-items: center;
    margin: 8px 0;
  }
  .redondo {
    width: 42px;
    height: 42px;
    border-radius: 50%;
  }
  .lineas {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  h1 {
    margin: 0;
    font-size: 26px;
    font-weight: 600;
    line-height: 1.3;
    letter-spacing: -0.01em;
    text-wrap: pretty;
    overflow-wrap: anywhere;
  }
  .etiquetas {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: -6px;
  }
  .chip.grande {
    line-height: 28px;
    padding: 0 4px 0 10px;
  }
  .quitar {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: inherit;
    opacity: 0.7;
    padding: 0;
  }
  .quitar:hover {
    opacity: 1;
    background: oklch(0 0 0 / 0.08);
  }
  .sospecha {
    display: flex;
    gap: 12px;
    padding: 14px 16px;
    border-radius: 10px;
    background: var(--prBg);
    color: var(--prT);
    line-height: 1.45;
  }
  .sospecha > :global(svg) {
    flex: none;
    margin-top: 2px;
  }
  .sospecha strong {
    font-size: 16px;
  }
  .sospecha p {
    margin: 0;
    font-size: 15px;
  }
  .que-hago {
    display: flex;
    gap: 18px;
    margin-top: 8px;
  }
  .que-hago .enlace {
    color: inherit;
    font-size: 15px;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .que-hago .suave {
    text-decoration: none;
    font-weight: 500;
    opacity: 0.85;
  }
  .de {
    display: flex;
    gap: 14px;
    align-items: flex-start;
  }
  .datos {
    flex: 1;
    min-width: 0;
    display: grid;
    line-height: 1.4;
  }
  .datos strong {
    font-size: 18px;
    font-weight: 600;
  }
  .direccion {
    font-size: 15px;
    color: var(--mut);
    overflow-wrap: anywhere;
  }
  .fecha-tel {
    display: none;
  }
  .de time {
    font-size: 15px;
    color: var(--mut);
    white-space: nowrap;
    padding-top: 2px;
  }
  .estrella {
    width: 36px;
    height: 36px;
    margin-top: -6px;
  }
  .estrella.activa {
    color: oklch(0.72 0.16 75);
  }
  .aviso-imagenes {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 10px;
    padding: 10px 14px;
    border-radius: 10px;
    background: var(--hun);
    font-size: 15px;
    color: var(--mut);
  }
  .aviso-imagenes span {
    flex: 1 1 200px;
  }
  .aviso-imagenes .suave {
    color: var(--mut);
    font-weight: 500;
  }
  iframe {
    width: 100%;
    max-width: 760px;
    min-height: 320px;
    flex: 1 0 320px;
    border: 1px solid var(--ls);
    border-radius: 10px;
    background: #fff;
  }
  .texto {
    font-size: 17px;
    line-height: 1.65;
    max-width: 700px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow-wrap: anywhere;
  }
  .texto p {
    margin: 0;
    white-space: pre-wrap;
  }
  .texto .cita {
    color: var(--mut);
    border-left: 3px solid var(--ls);
    padding-left: 14px;
    font-size: 15px;
  }
  .adjuntos {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 4px;
  }
  .resumen-adj {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--mut);
  }
  .resumen-adj strong {
    font-size: 16px;
    font-weight: 600;
    color: var(--fg);
  }
  .resumen-adj span {
    font-size: 15px;
  }
  .derecha {
    margin-left: auto;
  }
  .descargar-todo {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 38px;
    padding: 0 14px;
    border: 0;
    border-radius: 999px;
    font-size: 15px;
    font-weight: 600;
    color: var(--accT);
    background: transparent;
  }
  .descargar-todo:hover,
  .descargar-todo.abierto {
    background: var(--accBg);
  }
  .tarjetas {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 10px;
    max-width: 760px;
  }
  .tarjeta {
    position: relative;
    min-width: 0;
    border: 1px solid var(--ls);
    border-radius: 10px;
    overflow: hidden;
    background: var(--card);
  }
  .tarjeta:hover {
    border-color: var(--ln);
    box-shadow: 0 6px 18px -8px rgb(40 30 20 / 0.35);
  }
  .tarjeta.bloqueado {
    background: var(--hun);
  }
  .tarjeta.bloqueado:hover {
    box-shadow: none;
    border-color: var(--ls);
  }
  .vista-previa {
    position: relative;
    display: block;
    width: 100%;
    height: 96px;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
  }
  .vista-previa img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .rayado {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: repeating-linear-gradient(135deg, var(--hun) 0 8px, var(--mu) 8px 16px);
    color: var(--t3);
  }
  .sobre {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    background: oklch(0.15 0.01 60 / 0.55);
    opacity: 0;
    transition: opacity 0.12s;
  }
  .vista-previa:hover .sobre,
  .vista-previa:focus-visible .sobre,
  .sobre:focus-within {
    opacity: 1;
  }
  .pastilla {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 36px;
    padding: 0 14px;
    border-radius: 999px;
    background: #fff;
    color: oklch(0.15 0.01 60);
    font-size: 14px;
    font-weight: 600;
    text-decoration: none;
  }
  .pastilla.redonda {
    width: 36px;
    padding: 0;
    justify-content: center;
  }
  .pie {
    padding: 9px 10px;
    display: flex;
    align-items: center;
    gap: 8px;
    border-top: 1px solid var(--ls);
  }
  .bloqueado-pie {
    border-top: 0;
    padding: 12px 14px;
    color: var(--mut);
  }
  .nombre-adj {
    flex: 1;
    min-width: 0;
    display: grid;
    line-height: 1.3;
  }
  .nombre-adj span {
    font-size: 14px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--fg);
  }
  .nombre-adj small {
    font-size: 13px;
    color: var(--mut);
  }
  .responder {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 8px;
  }
  .boton.grande {
    min-height: 48px;
    padding: 0 22px;
    font-size: 17px;
    gap: 10px;
  }
  .botonera-tel {
    display: none;
  }

  /* Debajo de 1400 la ficha va adentro del mensaje, como en el teléfono. */
  @media (min-width: 1401px) {
    .leer :global(.ficha.compacta) {
      display: none;
    }
  }
  @media (max-width: 1400px) {
    .lector > :global(.ficha:not(.compacta)) {
      display: none;
    }
  }
  @media (max-width: 1280px) {
    .accion:not(.siempre) span {
      display: none;
    }
    .leer {
      padding: 20px 24px 28px;
    }
  }
  /* Teléfono: el correo a pantalla completa, con la barra propia arriba. */
  @media (max-width: 720px) {
    .acciones {
      padding: max(4px, env(safe-area-inset-top)) 8px 0;
      border-bottom: 0;
    }
    .volver {
      display: inline-grid;
      color: var(--fg);
      width: 44px;
      height: 44px;
    }
    .accion span {
      display: none;
    }
    .accion.siempre {
      display: none;
    }
    .accion {
      width: 44px;
      height: 44px;
      padding: 0;
      justify-content: center;
    }
    .accion :global(svg) {
      color: var(--fg);
      width: 22px;
      height: 22px;
    }
    .leer {
      padding: 4px 20px 20px;
      gap: 14px;
    }
    h1 {
      font-size: 23px;
    }
    .de {
      align-items: center;
    }
    .de time,
    .estrella {
      display: none;
    }
    .fecha-tel {
      display: block;
      font-size: 15px;
      color: var(--mut);
    }
    .direccion {
      display: none;
    }
    .datos strong {
      font-size: 17px;
    }
    .responder {
      display: none;
    }
    .tarjetas {
      grid-template-columns: 1fr 1fr;
    }
    .vista-previa {
      display: none;
    }
    .pie {
      border-top: 0;
      padding: 10px 12px;
    }
    .tarjeta {
      border-radius: 12px;
    }
    .botonera-tel {
      display: flex;
      gap: 10px;
      padding: 12px 16px calc(14px + env(safe-area-inset-bottom));
      border-top: 1px solid var(--ls);
      flex: none;
    }
    .botonera-tel .boton {
      flex: 1;
      height: 52px;
    }
    .lector:has(:global(.en-linea)) .botonera-tel {
      display: none;
    }
    iframe {
      min-height: 60vh;
    }
  }
</style>
