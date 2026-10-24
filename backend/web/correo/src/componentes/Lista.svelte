<script lang="ts">
  import { bandeja } from "../lib/estado.svelte";
  import { colorDe, fechaCorta, inicial, nombreDe } from "../lib/formato";
  import Icono from "./Icono.svelte";

  let busqueda = $state(bandeja.q);
  let espera: ReturnType<typeof setTimeout>;

  $effect(() => {
    // Si la búsqueda cambia desde afuera (atrás del navegador), el campo la sigue.
    busqueda = bandeja.q;
  });

  function alEscribir() {
    clearTimeout(espera);
    espera = setTimeout(() => bandeja.buscar(busqueda), 350);
  }

  // En Enviados y Borradores importa a quién se mandó, no quién lo mandó.
  const mostrarPara = $derived(bandeja.rolActual === "enviados" || bandeja.rolActual === "borradores");
  const enPapelera = $derived(bandeja.rolActual === "papelera" || bandeja.rolActual === "spam");

  // El foco del teclado sigue a la fila: que se vea sin tener que bajar.
  $effect(() => {
    const uid = bandeja.foco;
    if (uid) document.querySelector(`[data-uid="${uid}"]`)?.scrollIntoView({ block: "nearest" });
  });
</script>

<section class="lista" aria-label="Mensajes">
  <header>
    <button class="icono menu" aria-label="Carpetas" onclick={() => (bandeja.menuAbierto = true)}>
      <Icono nombre="menu" />
    </button>
    <h2>{bandeja.carpetaActual?.nombre ?? bandeja.carpeta}</h2>
    <button class="icono" title="Actualizar" aria-label="Actualizar" onclick={() => bandeja.refrescar()}>
      <Icono nombre="refrescar" tamano={16} />
    </button>
  </header>

  <div class="buscar">
    <Icono nombre="buscar" tamano={16} />
    <input
      id="buscar"
      type="search"
      placeholder="Buscar en {bandeja.carpetaActual?.nombre?.toLowerCase() ?? 'la carpeta'}"
      bind:value={busqueda}
      oninput={alEscribir}
      onkeydown={(e) => {
        if (e.key === "Escape") {
          busqueda = "";
          bandeja.buscar("");
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
    <span class="tecla">/</span>
  </div>

  {#if bandeja.marcados.size}
    <div class="lote" role="toolbar" aria-label="Acciones sobre los marcados">
      <label class="todos">
        <input
          type="checkbox"
          checked={bandeja.marcados.size === bandeja.visibles.length}
          onchange={() => bandeja.marcarTodos()}
        />
        {bandeja.marcados.size}
      </label>
      {#if enPapelera}
        <button class="icono" title="Devolver a la entrada" onclick={() => bandeja.accion("restaurar")}><Icono nombre="restaurar" /></button>
      {:else}
        <button class="icono" title="Archivar (e)" onclick={() => bandeja.accion("archivar")}><Icono nombre="archivo" /></button>
      {/if}
      <button class="icono" title="A la papelera (#)" onclick={() => bandeja.accion("papelera")}><Icono nombre="papelera" /></button>
      <button class="icono" title="Marcar leído" onclick={() => bandeja.accion("leido")}><Icono nombre="sobre-abierto" /></button>
      <button class="icono" title="Marcar sin leer" onclick={() => bandeja.accion("no-leido")}><Icono nombre="sobre" /></button>
      <button class="boton cancelar" onclick={() => (bandeja.marcados = new Set())}>Cancelar</button>
    </div>
  {/if}

  <div class="filas">
    {#if bandeja.error}
      <div class="vacio">
        <p>{bandeja.error}</p>
        <button class="boton" onclick={() => bandeja.cargarLista()}>Probar de nuevo</button>
      </div>
    {:else if bandeja.cargando && !bandeja.mensajes.length}
      {#each Array(8) as _, i (i)}
        <div class="fila esqueleto" aria-hidden="true"><span></span><span></span></div>
      {/each}
    {:else if !bandeja.visibles.length}
      <div class="vacio">
        {#if bandeja.q}
          <p>Nada con «{bandeja.q}» en {bandeja.carpetaActual?.nombre?.toLowerCase() ?? "esta carpeta"}.</p>
        {:else if bandeja.rolActual === "entrada"}
          <p><strong>La entrada está al día.</strong><br />Lo nuevo aparece acá.</p>
        {:else}
          <p>No hay nada en {bandeja.carpetaActual?.nombre?.toLowerCase() ?? "esta carpeta"}.</p>
        {/if}
      </div>
    {:else}
      <ul>
        {#each bandeja.visibles as m (m.uid)}
          {@const persona = mostrarPara ? m.para[0] : m.de[0]}
          <li
            data-uid={m.uid}
            class="fila"
            class:sin-leer={!m.leido}
            class:foco={bandeja.foco === m.uid}
            class:abierto={bandeja.uidAbierto === m.uid}
            class:marcado={bandeja.marcados.has(m.uid)}
          >
            <label class="marca" title="Marcar (x)">
              <input
                type="checkbox"
                checked={bandeja.marcados.has(m.uid)}
                onchange={() => bandeja.marcar(m.uid)}
                aria-label="Marcar «{m.asunto}»"
              />
              <span class="avatar" style:background={colorDe(persona)}>{inicial(persona)}</span>
            </label>
            <button class="contenido" onclick={() => bandeja.abrir(m.uid)}>
              <span class="linea1">
                <span class="quien">{mostrarPara ? "Para: " : ""}{nombreDe(persona)}</span>
                <time datetime={m.fecha}>{fechaCorta(m.fecha)}</time>
              </span>
              <span class="linea2">
                <span class="asunto">{m.asunto || "(sin asunto)"}</span>
                {#if m.adjuntos}<span class="adj" title="Tiene adjuntos"><Icono nombre="clip" tamano={14} /></span>{/if}
                {#if m.respondido}<span class="adj" title="Respondido"><Icono nombre="responder" tamano={14} /></span>{/if}
              </span>
            </button>
            <button
              class="estrella"
              class:activa={m.destacado}
              title={m.destacado ? "Quitar de destacados (s)" : "Destacar (s)"}
              aria-pressed={m.destacado}
              onclick={() => bandeja.accion(m.destacado ? "no-destacar" : "destacar", [m.uid])}
            >
              <Icono nombre="estrella" tamano={16} relleno={m.destacado} />
            </button>
          </li>
        {/each}
      </ul>
      {#if bandeja.paginas > 1 && !bandeja.q}
        <nav class="paginas" aria-label="Páginas">
          <button class="boton" disabled={bandeja.pagina <= 1} onclick={() => bandeja.cargarLista(bandeja.pagina - 1)}>Más nuevos</button>
          <span>{bandeja.pagina} de {bandeja.paginas}</span>
          <button class="boton" disabled={bandeja.pagina >= bandeja.paginas} onclick={() => bandeja.cargarLista(bandeja.pagina + 1)}>Más viejos</button>
        </nav>
      {/if}
    {/if}
  </div>

  <button class="boton principal flotante" onclick={() => bandeja.redactar("nuevo")} aria-label="Redactar">
    <Icono nombre="lapiz" /> Redactar
  </button>
</section>

<style>
  .lista {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--superficie);
    border-right: 1px solid var(--borde);
    position: relative;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 14px 6px 18px;
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: 1.35rem;
    letter-spacing: -0.01em;
  }
  .menu {
    display: none;
    margin-left: -8px;
  }
  .buscar {
    margin: 6px 14px 10px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    border: 1px solid var(--borde);
    border-radius: 10px;
    background: var(--superficie-2);
    color: var(--texto-3);
  }
  .buscar:focus-within {
    border-color: var(--naranja);
    background: var(--superficie);
  }
  .buscar input {
    flex: 1;
    border: 0;
    background: transparent;
    padding: 9px 0;
    outline: none;
    min-width: 0;
  }
  .lote {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 12px 8px;
    border-bottom: 1px solid var(--borde);
  }
  .todos {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    margin-right: 6px;
  }
  .cancelar {
    margin-left: auto;
  }
  .filas {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .fila {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px 0 10px;
    border-bottom: 1px solid var(--borde);
    position: relative;
  }
  .fila:hover {
    background: var(--superficie-2);
  }
  .fila.foco::before,
  .fila.abierto::before {
    content: "";
    position: absolute;
    left: 0;
    top: 6px;
    bottom: 6px;
    width: 3px;
    border-radius: 3px;
    background: var(--naranja);
  }
  .fila.abierto,
  .fila.marcado {
    background: var(--seleccion);
  }
  .marca {
    position: relative;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    flex: none;
    cursor: pointer;
  }
  .marca input {
    position: absolute;
    opacity: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    cursor: pointer;
  }
  .avatar {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: #fff;
    font-weight: 700;
    font-size: 0.95rem;
  }
  .fila.marcado .avatar {
    background: var(--naranja) !important;
    font-size: 0;
  }
  .fila.marcado .avatar::after {
    content: "✓";
    font-size: 1rem;
  }
  .marca:focus-within .avatar {
    outline: 2px solid var(--naranja);
    outline-offset: 2px;
  }
  .contenido {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 2px;
    padding: 11px 6px;
    border: 0;
    background: transparent;
    text-align: left;
  }
  .linea1,
  .linea2 {
    display: flex;
    gap: 8px;
    align-items: baseline;
    min-width: 0;
  }
  .quien,
  .asunto {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .quien {
    color: var(--texto-2);
  }
  .asunto {
    color: var(--texto-2);
    font-size: 0.93rem;
  }
  time {
    flex: none;
    font-size: 0.82rem;
    color: var(--texto-3);
    font-variant-numeric: tabular-nums;
  }
  .sin-leer .quien,
  .sin-leer .asunto {
    color: var(--texto);
    font-weight: 700;
  }
  .sin-leer time {
    color: var(--naranja-fuerte);
    font-weight: 700;
  }
  .adj {
    color: var(--texto-3);
    flex: none;
    align-self: center;
    display: inline-flex;
  }
  .estrella {
    border: 0;
    background: transparent;
    color: var(--texto-3);
    padding: 8px;
    border-radius: 8px;
    opacity: 0;
  }
  .fila:hover .estrella,
  .estrella.activa,
  .estrella:focus-visible {
    opacity: 1;
  }
  .estrella.activa {
    color: oklch(0.75 0.16 75);
  }
  .esqueleto {
    height: 62px;
    display: grid;
    align-content: center;
    gap: 8px;
    padding-left: 60px;
  }
  .esqueleto span {
    height: 10px;
    border-radius: 5px;
    background: var(--superficie-2);
    animation: latido 1.2s ease-in-out infinite;
  }
  .esqueleto span:first-child {
    width: 40%;
  }
  .esqueleto span:last-child {
    width: 75%;
  }
  @keyframes latido {
    50% {
      opacity: 0.5;
    }
  }
  .vacio {
    padding: 48px 24px;
    text-align: center;
    color: var(--texto-2);
  }
  .vacio strong {
    color: var(--texto);
    font-size: 1.05rem;
  }
  .paginas {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px;
    color: var(--texto-2);
    font-size: 0.9rem;
  }
  .flotante {
    display: none;
  }

  @media (max-width: 1080px) {
    .menu {
      display: inline-grid;
    }
  }
  @media (max-width: 720px) {
    .lista {
      border-right: 0;
    }
    .estrella {
      opacity: 1;
    }
    .flotante {
      display: inline-flex;
      position: absolute;
      right: 16px;
      bottom: calc(16px + env(safe-area-inset-bottom));
      padding: 0.85em 1.2em;
      border-radius: 16px;
      box-shadow: var(--sombra);
    }
    .filas {
      padding-bottom: 80px;
    }
  }
</style>
