<script lang="ts">
  import type { Resumen } from "../lib/api";
  import { bandeja, type Pestana } from "../lib/estado.svelte";
  import { clientes } from "../lib/clientes.svelte";
  import { familiaDe } from "../lib/etiquetas";
  import { fechaCorta, grupoDeFecha, iniciales, nombreDe } from "../lib/formato";
  import Icono from "./Icono.svelte";

  // En Enviados y Borradores importa a quién se mandó, no quién lo mandó.
  const mostrarPara = $derived(bandeja.rolActual === "enviados" || bandeja.rolActual === "borradores");
  const enPapelera = $derived(bandeja.rolActual === "papelera" || bandeja.rolActual === "spam");
  const nombreCarpeta = $derived(bandeja.carpetaActual?.nombre?.toLowerCase() ?? "esta carpeta");

  const pestanas = $derived<[Pestana, string, number][]>([
    ["todos", "Todos", 0],
    ["sin-leer", "Sin leer", bandeja.carpetaActual?.noLeidos ?? 0],
    ["sin-responder", "Esperan respuesta", bandeja.pestana === "sin-responder" ? bandeja.total : 0],
  ]);

  // Los grupos («Hoy», «Ayer»…) solo cuando la lista va por fecha, no en
  // una búsqueda.
  function grupo(m: Resumen, i: number): string {
    if (bandeja.q) return "";
    const g = grupoDeFecha(m.fecha);
    return i === 0 || grupoDeFecha(bandeja.visibles[i - 1].fecha) !== g ? g : "";
  }

  // El foco del teclado sigue a la fila: que se vea sin tener que bajar.
  $effect(() => {
    const uid = bandeja.foco;
    if (uid) document.querySelector(`[data-uid="${uid}"]`)?.scrollIntoView({ block: "nearest" });
  });

  // Los remitentes de la página, para saber cuáles son clientes.
  $effect(() => {
    void clientes.conocer(bandeja.mensajes.map((m) => (mostrarPara ? m.para[0] : m.de[0])?.correo));
  });

  // Deslizar una fila a la izquierda la archiva (2f). Solo con el dedo: con
  // el mouse, arrastrar es seleccionar texto.
  const UMBRAL = 110;
  let arrastre = $state<{ uid: number; x0: number; y0: number; dx: number; activo: boolean } | null>(null);

  function tocar(e: PointerEvent, uid: number) {
    if (e.pointerType !== "touch") return;
    arrastre = { uid, x0: e.clientX, y0: e.clientY, dx: 0, activo: false };
  }
  function mover(e: PointerEvent) {
    if (!arrastre) return;
    const dx = e.clientX - arrastre.x0;
    const dy = e.clientY - arrastre.y0;
    if (!arrastre.activo) {
      if (Math.abs(dy) > 12) return void (arrastre = null); // está bajando la lista
      if (dx < -12) arrastre.activo = true;
    }
    if (arrastre.activo) arrastre.dx = Math.min(0, dx);
  }
  function soltar() {
    if (!arrastre) return;
    const { uid, dx, activo } = arrastre;
    arrastre = null;
    if (activo && dx < -UMBRAL) void bandeja.accion(bandeja.rolActual === "archivo" || enPapelera ? "restaurar" : "archivar", [uid]);
  }
  let saltarClick = false;
  function abrirFila(uid: number) {
    if (saltarClick) return void (saltarClick = false);
    bandeja.abrir(uid);
  }
</script>

<section class="lista" aria-label="Mensajes">
  <div class="pestanas" role="tablist" aria-label="Qué mostrar">
    {#each pestanas as [id, nombre, n] (id)}
      <button role="tab" class="pestana" class:actual={bandeja.pestana === id} aria-selected={bandeja.pestana === id} onclick={() => bandeja.elegirPestana(id)}>
        {nombre}
        {#if n}<span class="contador">{n}</span>{/if}
      </button>
    {/each}
    <button class="icono refrescar" class:girando={bandeja.cargando} title="Actualizar" aria-label="Actualizar" onclick={() => bandeja.refrescar(true)}>
      <Icono nombre="refrescar" tamano={19} />
    </button>
  </div>
  {#if bandeja.cargando}
    <div class="progreso" aria-hidden="true"><span></span></div>
  {/if}

  {#if bandeja.q}
    <div class="buscando">
      <span>{bandeja.total === 1 ? "1 resultado" : `${bandeja.total} resultados`} de «{bandeja.q}»</span>
      <button class="enlace" onclick={() => bandeja.buscar("")}>Ver todos</button>
    </div>
  {:else if !bandeja.carpetaActual || bandeja.rolActual !== "entrada"}
    <h2 class="titulo-tel">{bandeja.carpetaActual?.nombre ?? ""}</h2>
  {:else}
    <h2 class="titulo-tel">Entrada · {bandeja.correo?.replace(/@.*/, "@")}</h2>
  {/if}

  {#if bandeja.marcados.size}
    <div class="lote" role="toolbar" aria-label="Acciones sobre los marcados">
      <button class="casilla marcada" aria-label="Marcar todos" onclick={() => bandeja.marcarTodos()}>
        <Icono nombre={bandeja.marcados.size === bandeja.visibles.length ? "tilde" : "minimizar"} tamano={15} />
      </button>
      <strong>{bandeja.marcados.size}</strong>
      {#if enPapelera}
        <button class="icono" title="Devolver a la entrada" onclick={() => bandeja.accion("restaurar")}><Icono nombre="restaurar" /></button>
      {:else}
        <button class="icono" title="Archivar (e)" onclick={() => bandeja.accion("archivar")}><Icono nombre="archivo" /></button>
      {/if}
      <button class="icono" title="Borrar (#)" onclick={() => bandeja.accion("papelera")}><Icono nombre="papelera" /></button>
      <button class="icono" title="Marcar leídos" onclick={() => bandeja.accion("leido")}><Icono nombre="sobre-abierto" /></button>
      <button class="icono" title="Marcar sin leer" onclick={() => bandeja.accion("no-leido")}><Icono nombre="sobre" /></button>
      <button class="enlace cancelar" onclick={() => (bandeja.marcados = new Set())}>Cancelar</button>
    </div>
  {/if}

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="filas" onpointermove={mover} onpointerup={soltar} onpointercancel={() => (arrastre = null)}>
    {#if bandeja.error && !bandeja.mensajes.length}
      <div class="vacio">
        <Icono nombre={bandeja.sinConexion ? "sin-red" : "sin-servidor"} tamano={30} />
        <strong>{bandeja.sinConexion ? "Sin conexión" : "No pudimos cargar los correos"}</strong>
        {#if bandeja.sinConexion}
          <p>No hay internet y todavía no se había bajado nada de esta carpeta. Apenas vuelva, se carga sola.</p>
        {:else}
          <p>
            El servidor de correo no responde.
            {#if bandeja.reintentoEn > 0}Volvemos a probar solos en {bandeja.reintentoEn} segundos.{/if}
          </p>
        {/if}
        <button class="boton" onclick={() => bandeja.refrescar(true)}><Icono nombre="refrescar" tamano={16} />Reintentar ahora</button>
        {#if !bandeja.sinConexion}<small>Si sigue igual, avisale a quien administra el correo.</small>{/if}
      </div>
    {:else if !bandeja.listaLista}
      {#each [[46, 78], [38, 64], [52, 82], [30, 70], [44, 60], [36, 74], [48, 66]] as [a, b], i (i)}
        <div class="fila esqueleto-fila" aria-hidden="true">
          <span class="avatar esqueleto" style:width="42px" style:height="42px"></span>
          <span class="lineas">
            <span class="l1"><span class="esqueleto" style:width="{a}%" style:height="12px"></span><span class="esqueleto" style:width="36px" style:height="10px"></span></span>
            <span class="esqueleto" style:width="{b}%" style:height="10px"></span>
            <span class="esqueleto" style:width="50%" style:height="10px"></span>
          </span>
        </div>
      {/each}
    {:else if !bandeja.visibles.length}
      <div class="vacio">
        {#if bandeja.q}
          <Icono nombre="buscar" tamano={30} />
          <strong>Nada con «{bandeja.q}»</strong>
          <p>No hay correos en {nombreCarpeta} que digan eso{bandeja.chips.dias || bandeja.chips.adjuntos || bandeja.chips.de ? " con esos filtros" : ""}.</p>
          <button class="enlace" onclick={() => bandeja.buscar("")}>Ver todos los correos</button>
        {:else if bandeja.pestana === "sin-leer"}
          <Icono nombre="todo-leido" tamano={30} />
          <strong>No hay correos sin leer</strong>
          <p>Todo lo que llegó a {nombreCarpeta} ya está leído.</p>
          <button class="enlace" onclick={() => bandeja.elegirPestana("todos")}>Ver todos los correos</button>
        {:else if bandeja.pestana === "sin-responder"}
          <Icono nombre="todo-leido" tamano={30} />
          <strong>Nadie espera respuesta</strong>
          <p>Todo lo que llegó en las últimas dos semanas ya se contestó.</p>
          <button class="enlace" onclick={() => bandeja.elegirPestana("todos")}>Ver todos los correos</button>
        {:else if bandeja.rolActual === "entrada"}
          <Icono nombre="todo-leido" tamano={30} />
          <strong>La entrada está vacía</strong>
          <p>Lo que llegue aparece acá.</p>
        {:else}
          <Icono nombre="carpeta" tamano={30} />
          <strong>No hay nada en {nombreCarpeta}</strong>
        {/if}
      </div>
    {:else}
      <ul>
        {#each bandeja.visibles as m, i (m.uid)}
          {@const persona = mostrarPara ? m.para[0] : m.de[0]}
          {@const g = grupo(m, i)}
          {@const desliza = arrastre?.uid === m.uid && arrastre.activo ? arrastre.dx : 0}
          {#if g}<li class="grupo">{g}</li>{/if}
          <li class="envoltura">
            {#if desliza}
              <div class="debajo" class:listo={desliza < -UMBRAL}>
                <Icono nombre={bandeja.rolActual === "archivo" || enPapelera ? "restaurar" : "archivo"} tamano={22} />
                {bandeja.rolActual === "archivo" || enPapelera ? "A la entrada" : "Archivar"}
              </div>
            {/if}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              data-uid={m.uid}
              class="fila"
              class:sin-leer={!m.leido}
              class:foco={bandeja.foco === m.uid}
              class:abierto={bandeja.uidAbierto === m.uid}
              class:marcado={bandeja.marcados.has(m.uid)}
              style:transform={desliza ? `translateX(${desliza}px)` : undefined}
              onpointerdown={(e) => tocar(e, m.uid)}
              onclickcapture={() => {
                if (desliza) saltarClick = true;
              }}
            >
              <button
                class="avatar {clientes.tipo(persona?.correo)}"
                aria-pressed={bandeja.marcados.has(m.uid)}
                aria-label="Elegir «{m.asunto || 'sin asunto'}»"
                title="Elegir (x)"
                onclick={() => bandeja.marcar(m.uid)}
              >
                {#if bandeja.marcados.has(m.uid)}<Icono nombre="tilde" tamano={20} />{:else}{iniciales(persona)}{/if}
              </button>
              <button class="contenido" onclick={() => abrirFila(m.uid)}>
                <span class="l1">
                  <span class="quien">{mostrarPara ? "Para: " : ""}{nombreDe(persona)}</span>
                  <span class="empuje"></span>
                  {#if m.adjuntos}<span class="marca-adj" title="Tiene adjuntos"><Icono nombre="clip" tamano={16} /></span>{/if}
                  {#if m.respondido}<span class="marca-adj" title="Respondido"><Icono nombre="responder" tamano={16} /></span>{/if}
                  <time datetime={m.fecha}>{fechaCorta(m.fecha)}</time>
                </span>
                <span class="asunto">{m.asunto || "(sin asunto)"}</span>
                <span class="l3">
                  <span class="vista">{m.vista || " "}</span>
                  {#if m.etiquetas?.length}<span class="chip {familiaDe(m.etiquetas[0])}">{m.etiquetas[0]}</span>{/if}
                </span>
              </button>
              <button
                class="estrella"
                class:activa={m.destacado}
                title={m.destacado ? "Quitar de destacados (s)" : "Destacar (s)"}
                aria-label={m.destacado ? "Quitar de destacados" : "Destacar"}
                aria-pressed={m.destacado}
                onclick={() => bandeja.accion(m.destacado ? "no-destacar" : "destacar", [m.uid])}
              >
                <Icono nombre="estrella" tamano={17} relleno={m.destacado} />
              </button>
            </div>
          </li>
        {/each}
      </ul>
      {#if bandeja.paginas > 1}
        <nav class="paginas" aria-label="Páginas">
          <button class="boton" disabled={bandeja.pagina <= 1} onclick={() => bandeja.cargarLista(bandeja.pagina - 1)}>Más nuevos</button>
          <span>{bandeja.pagina} de {bandeja.paginas}</span>
          <button class="boton" disabled={bandeja.pagina >= bandeja.paginas} onclick={() => bandeja.cargarLista(bandeja.pagina + 1)}>Más viejos</button>
        </nav>
      {/if}
    {/if}
  </div>

  <button class="flotante" onclick={() => bandeja.redactar("nuevo")}>
    <Icono nombre="lapiz" tamano={21} /> Redactar
  </button>
</section>

<style>
  .lista {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    border-right: 1px solid var(--ls);
  }
  .pestanas {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 56px;
    flex: none;
    padding: 0 12px 0 16px;
    border-bottom: 1px solid var(--ls);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .pestana {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 56px;
    padding: 0 12px;
    border: 0;
    background: transparent;
    white-space: nowrap;
    font-size: 16px;
    font-weight: 500;
    color: var(--mut);
  }
  .pestana:hover {
    color: var(--fg);
  }
  .pestana.actual {
    color: var(--accT);
    font-weight: 600;
    box-shadow: inset 0 -3px 0 var(--acc);
  }
  .pestana.actual .contador {
    background: var(--acc);
    color: #fff;
  }
  .refrescar {
    margin-left: auto;
  }
  .girando :global(svg) {
    animation: girar 0.9s linear infinite;
  }
  @keyframes girar {
    to {
      transform: rotate(360deg);
    }
  }
  /* La barra fina de «cargando», arriba de la lista: no empuja nada. */
  .progreso {
    position: absolute;
    top: 55px;
    left: 0;
    right: 0;
    height: 3px;
    background: var(--accBg);
    overflow: hidden;
    z-index: 2;
  }
  .progreso span {
    position: absolute;
    left: 0;
    width: 34%;
    height: 100%;
    border-radius: 2px;
    background: var(--acc);
    animation: ir 1.2s ease-in-out infinite;
  }
  @keyframes ir {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(300%);
    }
  }
  .buscando {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 20px;
    font-size: 15px;
    font-weight: 600;
    color: var(--mut);
    border-bottom: 1px solid var(--ls);
  }
  .titulo-tel {
    display: none;
  }
  .lote {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 12px 6px 26px;
    border-bottom: 1px solid var(--ls);
    background: var(--sel);
  }
  .lote strong {
    margin: 0 8px 0 6px;
  }
  .lote .casilla {
    border: 0;
  }
  .cancelar {
    margin-left: auto;
    padding: 8px;
  }
  .filas {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .grupo {
    padding: 14px 20px 6px;
    font-size: 14px;
    font-weight: 600;
    color: var(--mut);
  }
  .envoltura {
    position: relative;
    overflow: hidden;
  }
  .debajo {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding-right: 24px;
    background: var(--ceT);
    color: var(--card);
    font-size: 16px;
    font-weight: 600;
  }
  .debajo.listo {
    background: var(--okT);
  }
  .fila {
    position: relative;
    display: flex;
    gap: 14px;
    padding: var(--py) 10px var(--py) 16px;
    background-color: transparent;
    touch-action: pan-y;
  }
  .envoltura:has(.debajo) .fila {
    background: var(--card);
  }
  .fila:hover {
    background: var(--sel);
  }
  .fila.abierto,
  .fila.marcado {
    background: var(--sel);
    box-shadow: inset 4px 0 0 var(--acc);
  }
  .fila.foco:not(.abierto) {
    box-shadow: inset 4px 0 0 var(--ln);
  }
  .fila > .avatar {
    width: 42px;
    height: 42px;
    border: 0;
    font-size: 16px;
    padding: 0;
  }
  .fila.marcado > .avatar {
    background: var(--acc);
    color: #fff;
  }
  .contenido {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 0;
    padding: 0;
    border: 0;
    background: transparent;
    text-align: left;
    line-height: 1.4;
    color: var(--fg);
  }
  .l1,
  .l3 {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .quien {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 17px;
    font-weight: 400;
  }
  .empuje {
    flex: 1;
  }
  .marca-adj {
    display: inline-flex;
    color: var(--mut);
    flex: none;
  }
  time {
    flex: none;
    font-size: 15px;
    color: var(--mut);
    font-variant-numeric: tabular-nums;
  }
  .asunto {
    font-size: 16px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .vista {
    flex: 1;
    min-width: 0;
    font-size: 15px;
    color: var(--mut);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sin-leer .quien,
  .sin-leer time {
    font-weight: 700;
  }
  .sin-leer time {
    color: var(--accT);
  }
  .sin-leer .asunto {
    font-weight: 600;
  }
  .estrella {
    align-self: flex-start;
    width: 34px;
    height: 34px;
    margin-top: 26px;
    flex: none;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--t3);
    opacity: 0;
  }
  .fila:hover .estrella,
  .estrella.activa,
  .estrella:focus-visible {
    opacity: 1;
  }
  .estrella.activa {
    color: oklch(0.72 0.16 75);
  }
  .esqueleto-fila {
    pointer-events: none;
  }
  .lineas {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 4px;
  }
  .lineas .l1 {
    justify-content: space-between;
    gap: 12px;
  }
  .vacio {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 110px 36px 40px;
    text-align: center;
    gap: 6px;
    color: var(--mut);
  }
  .vacio :global(svg) {
    margin-bottom: 8px;
  }
  .vacio strong {
    font-size: 17px;
    font-weight: 600;
    color: var(--fg);
  }
  .vacio p {
    margin: 0;
    font-size: 15px;
    text-wrap: pretty;
  }
  .vacio .boton {
    margin-top: 12px;
    font-size: 15px;
  }
  .vacio .enlace {
    margin-top: 10px;
    font-size: 15px;
  }
  .vacio small {
    margin-top: 8px;
    font-size: 14px;
  }
  .paginas {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px;
    color: var(--mut);
    font-size: 15px;
  }
  .flotante {
    display: none;
  }

  @media (max-width: 720px) {
    .lista {
      border-right: 0;
    }
    .pestanas {
      height: 48px;
      padding: 0 8px;
      border-bottom: 0;
    }
    .pestana {
      height: 48px;
      font-size: 15px;
    }
    .progreso {
      top: 47px;
    }
    .titulo-tel {
      display: block;
      margin: 0;
      padding: 6px 20px 4px;
      font-size: 15px;
      font-weight: 600;
      color: var(--mut);
    }
    .fila {
      padding: 12px 12px 12px 16px;
    }
    .fila > .avatar {
      width: 44px;
      height: 44px;
    }
    .estrella {
      display: none;
    }
    .flotante {
      position: absolute;
      right: 18px;
      bottom: calc(24px + env(safe-area-inset-bottom));
      display: inline-flex;
      align-items: center;
      gap: 12px;
      height: 60px;
      padding: 0 24px 0 20px;
      border: 0;
      border-radius: 18px;
      background: var(--acc);
      color: #fff;
      font-size: 17px;
      font-weight: 600;
      box-shadow: 0 6px 18px -4px rgb(80 40 10 / 0.45);
      z-index: 3;
    }
    .filas {
      padding-bottom: 96px;
    }
  }
</style>
