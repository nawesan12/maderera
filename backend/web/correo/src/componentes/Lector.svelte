<script lang="ts">
  import { api } from "../lib/api";
  import { bandeja } from "../lib/estado.svelte";
  import { colorDe, direccionCompleta, fechaLarga, inicial, nombreDe, tamano } from "../lib/formato";
  import Icono from "./Icono.svelte";

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

  const m = $derived(bandeja.abierto);
  const remitente = $derived(m?.de[0]?.correo ?? "");
  $effect(() => {
    verImagenes = !!remitente && confiables().has(remitente);
  });

  function permitirSiempre() {
    const s = confiables();
    s.add(remitente);
    localStorage.setItem(CLAVE_CONFIABLES, JSON.stringify([...s].slice(-500)));
    verImagenes = true;
  }

  const enPapelera = $derived(bandeja.rolActual === "papelera" || bandeja.rolActual === "spam");

  // El texto plano con los enlaces clickeables y las citas («> ») atenuadas,
  // sin pasar nunca por innerHTML.
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
  const lineas = $derived((m?.texto ?? "").split("\n"));

  const sePuedeVer = (tipo: string) => /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)$/.test(tipo);
</script>

<article class="lector" aria-label="Mensaje">
  {#if !bandeja.uidAbierto}
    <div class="nada">
      <Icono nombre="sobre-abierto" tamano={44} />
      <p>Elegí un mensaje para leerlo.</p>
      <p class="pista"><span class="tecla">j</span> <span class="tecla">k</span> para moverse · <span class="tecla">?</span> todos los atajos</p>
    </div>
  {:else}
    <div class="barra" role="toolbar" aria-label="Acciones">
      <button class="icono" title="Volver (u)" aria-label="Volver" onclick={() => bandeja.cerrar()}><Icono nombre="atras" /></button>
      <span class="separador"></span>
      {#if enPapelera}
        <button class="icono" title="Devolver a la entrada" onclick={() => bandeja.accion("restaurar")}><Icono nombre="restaurar" /></button>
      {:else if bandeja.rolActual === "archivo"}
        <button class="icono" title="Devolver a la entrada (e)" onclick={() => bandeja.accion("restaurar")}><Icono nombre="entrada" /></button>
      {:else}
        <button class="icono" title="Archivar (e)" onclick={() => bandeja.accion("archivar")}><Icono nombre="archivo" /></button>
      {/if}
      <button
        class="icono"
        title={bandeja.rolActual === "papelera" ? "Borrar para siempre (#)" : "A la papelera (#)"}
        onclick={() => bandeja.accion("papelera")}><Icono nombre="papelera" /></button
      >
      {#if !enPapelera}
        <button class="icono" title="Es spam (!)" onclick={() => bandeja.accion("spam")}><Icono nombre="spam" /></button>
      {/if}
      <button class="icono" title="Marcar sin leer (U)" onclick={() => { void bandeja.accion("no-leido"); bandeja.cerrar(); }}>
        <Icono nombre="sobre" />
      </button>
      {#if m}
        <button
          class="icono"
          class:activa={m.destacado}
          title={m.destacado ? "Quitar de destacados (s)" : "Destacar (s)"}
          onclick={() => bandeja.accion(m.destacado ? "no-destacar" : "destacar")}
        >
          <Icono nombre="estrella" relleno={m.destacado} />
        </button>
      {/if}
      <span class="empuje"></span>
      {#if m}
        <button class="boton" onclick={() => bandeja.redactar("responder", m)} title="Responder (r)"><Icono nombre="responder" /> <span class="texto-boton">Responder</span></button>
      {/if}
    </div>

    {#if !m}
      <div class="nada" aria-busy="true"><p>Abriendo…</p></div>
    {:else}
      <div class="cabecera">
        <h1>{m.asunto || "(sin asunto)"}</h1>
        <div class="de">
          <span class="avatar" style:background={colorDe(m.de[0])}>{inicial(m.de[0])}</span>
          <div class="datos">
            <div class="fila1">
              <strong>{nombreDe(m.de[0])}</strong>
              {#if m.de[0]?.nombre}<span class="direccion">&lt;{m.de[0].correo}&gt;</span>{/if}
            </div>
            <div class="para">
              Para {m.para.map(direccionCompleta).join(", ") || "—"}
              {#if m.cc.length}<br />Copia {m.cc.map(direccionCompleta).join(", ")}{/if}
            </div>
          </div>
          <time datetime={m.fecha}>{fechaLarga(m.fecha)}</time>
        </div>
      </div>

      {#if m.adjuntos.length}
        <ul class="adjuntos" aria-label="Adjuntos">
          {#each m.adjuntos as a (a.indice)}
            <li>
              {#if sePuedeVer(a.tipo)}
                <a href={api.urlAdjunto(bandeja.carpeta, m.uid, a.indice, true)} target="_blank" rel="noopener" title="Ver {a.nombre}">
                  <Icono nombre={a.tipo.startsWith("image/") ? "imagen" : "clip"} tamano={16} />
                  <span class="nombre-adj">{a.nombre}</span>
                </a>
              {:else}
                <span class="sin-vista"><Icono nombre="clip" tamano={16} /> <span class="nombre-adj">{a.nombre}</span></span>
              {/if}
              <span class="peso">{tamano(a.tamano)}</span>
              <a class="bajar" href={api.urlAdjunto(bandeja.carpeta, m.uid, a.indice)} download={a.nombre} title="Bajar {a.nombre}" aria-label="Bajar {a.nombre}">
                <Icono nombre="descargar" tamano={16} />
              </a>
            </li>
          {/each}
        </ul>
      {/if}

      {#if m.tieneHtml && m.imagenesRemotas && !verImagenes}
        <div class="aviso-imagenes">
          <span>Las imágenes de afuera no se cargaron: avisan a quien mandó el correo que lo abriste.</span>
          <button class="boton" onclick={() => (verImagenes = true)}>Mostrarlas</button>
          <button class="boton" onclick={permitirSiempre}>Siempre de {remitente}</button>
        </div>
      {/if}

      <div class="cuerpo">
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
            {#each lineas as linea, i (i)}
              <p class:cita={linea.startsWith(">")}>
                {#each trozos(linea) as t, j (j)}{#if t.enlace}<a href={t.enlace} target="_blank" rel="noopener noreferrer">{t.texto}</a>{:else}{t.texto}{/if}{/each}{#if !linea}&nbsp;{/if}
              </p>
            {/each}
          </div>
        {/if}
      </div>

      <div class="responder">
        <button class="boton" onclick={() => bandeja.redactar("responder", m)}><Icono nombre="responder" /> Responder</button>
        {#if m.para.length + m.cc.length > 1}
          <button class="boton" onclick={() => bandeja.redactar("responder-todos", m)}><Icono nombre="responder-todos" /> A todos</button>
        {/if}
        <button class="boton" onclick={() => bandeja.redactar("reenviar", m)}><Icono nombre="reenviar" /> Reenviar</button>
      </div>
    {/if}
  {/if}
</article>

<style>
  .lector {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--superficie);
    overflow-y: auto;
  }
  .nada {
    margin: auto;
    text-align: center;
    color: var(--texto-3);
    padding: 24px;
  }
  .nada p {
    margin: 10px 0 0;
    color: var(--texto-2);
  }
  .pista {
    font-size: 0.85rem;
  }
  .barra {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 8px 12px;
    background: var(--superficie);
    border-bottom: 1px solid var(--borde);
  }
  .separador {
    width: 1px;
    height: 22px;
    background: var(--borde);
    margin: 0 6px;
  }
  .empuje {
    flex: 1;
  }
  .icono.activa {
    color: oklch(0.75 0.16 75);
  }
  .cabecera {
    padding: 22px 28px 10px;
  }
  h1 {
    margin: 0 0 18px;
    font-size: 1.45rem;
    line-height: 1.25;
    letter-spacing: -0.01em;
    overflow-wrap: anywhere;
  }
  .de {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  .avatar {
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: #fff;
    font-weight: 700;
  }
  .datos {
    flex: 1;
    min-width: 0;
  }
  .fila1 {
    display: flex;
    flex-wrap: wrap;
    gap: 0 6px;
    align-items: baseline;
  }
  .direccion,
  .para {
    color: var(--texto-2);
    font-size: 0.88rem;
    overflow-wrap: anywhere;
  }
  time {
    flex: none;
    color: var(--texto-3);
    font-size: 0.85rem;
    text-align: right;
    max-width: 14em;
  }
  .adjuntos {
    list-style: none;
    margin: 8px 28px 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .adjuntos li {
    display: flex;
    align-items: center;
    gap: 8px;
    border: 1px solid var(--borde);
    border-radius: 10px;
    padding: 6px 6px 6px 10px;
    background: var(--superficie-2);
    max-width: 100%;
  }
  .adjuntos a,
  .sin-vista {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: inherit;
    text-decoration: none;
    min-width: 0;
  }
  .nombre-adj {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 22ch;
    font-weight: 500;
  }
  .peso {
    color: var(--texto-3);
    font-size: 0.82rem;
  }
  .bajar {
    padding: 4px;
    border-radius: 6px;
    color: var(--texto-2);
  }
  .bajar:hover {
    background: var(--borde);
  }
  .aviso-imagenes {
    margin: 14px 28px 0;
    padding: 10px 12px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    border-radius: 10px;
    background: var(--naranja-suave);
    font-size: 0.9rem;
  }
  .aviso-imagenes span {
    flex: 1 1 260px;
  }
  .cuerpo {
    flex: 1;
    display: flex;
    min-height: 320px;
    padding: 14px 28px 0;
  }
  iframe {
    flex: 1;
    width: 100%;
    min-height: 60vh;
    border: 1px solid var(--borde);
    border-radius: 10px;
    background: #fff;
  }
  .texto {
    font-size: 1rem;
    line-height: 1.6;
    overflow-wrap: anywhere;
    max-width: 75ch;
  }
  .texto p {
    margin: 0;
    white-space: pre-wrap;
  }
  .texto .cita {
    color: var(--texto-2);
    border-left: 3px solid var(--borde);
    padding-left: 10px;
  }
  .texto a {
    color: var(--naranja-fuerte);
  }
  .responder {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 18px 28px 28px;
  }

  @media (min-width: 721px) {
    .barra > .icono:first-child,
    .barra > .separador {
      display: none;
    }
  }
  @media (max-width: 720px) {
    .cabecera {
      padding: 16px 16px 6px;
    }
    .adjuntos,
    .aviso-imagenes {
      margin-left: 16px;
      margin-right: 16px;
    }
    .cuerpo {
      padding: 12px 12px 0;
    }
    .responder {
      padding: 14px 16px calc(20px + env(safe-area-inset-bottom));
    }
    .de {
      flex-wrap: wrap;
    }
    .de time {
      width: 100%;
      max-width: none;
      text-align: left;
      padding-left: 52px;
      margin-top: -6px;
    }
    .texto-boton {
      display: none;
    }
  }
</style>
