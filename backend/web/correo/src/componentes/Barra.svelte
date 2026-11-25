<script lang="ts">
  import { api, type Resumen } from "../lib/api";
  import { bandeja } from "../lib/estado.svelte";
  import { preferencias } from "../lib/preferencias.svelte";
  import { fechaCorta, iniciales, nombreDe } from "../lib/formato";
  import { sesion } from "../lib/sesion.svelte";
  import { clientes } from "../lib/clientes.svelte";
  import Icono from "./Icono.svelte";

  // La búsqueda (2c): los resultados aparecen mientras se escribe, en un
  // panel debajo del buscador; Enter o «Ver los N resultados» los pasa a la
  // lista. Los filtros son botones.
  let texto = $state(bandeja.q);
  let abierto = $state(false);
  let resultados = $state<Resumen[]>([]);
  let totalResultados = $state(0);
  let buscando = $state(false);
  let elegido = $state(-1);
  let menuFecha = $state(false);
  let menuDe = $state(false);
  let menuCuenta = $state(false);
  let textoDe = $state(bandeja.chips.de);
  let espera: ReturnType<typeof setTimeout>;
  let pedido = 0;
  let caja: HTMLDivElement;
  let campo: HTMLInputElement;

  $effect(() => {
    // Si la búsqueda cambia desde afuera (atrás del navegador), el campo la sigue.
    texto = bandeja.q;
  });

  const fechas: [number, string][] = [
    [0, "Cualquier fecha"],
    [7, "Última semana"],
    [30, "Último mes"],
    [365, "Último año"],
  ];
  const nombreFecha = $derived(fechas.find(([d]) => d === bandeja.chips.dias)?.[1] ?? "Cualquier fecha");

  async function traer() {
    const q = texto.trim();
    if (!q) {
      resultados = [];
      totalResultados = 0;
      return;
    }
    const n = ++pedido;
    buscando = true;
    try {
      const f = { q, dias: bandeja.chips.dias || undefined, adjuntos: bandeja.chips.adjuntos, de: bandeja.chips.de || undefined };
      const p = await api.lista(bandeja.carpeta, 1, f);
      if (n !== pedido) return;
      resultados = p.mensajes.slice(0, 5);
      totalResultados = p.total;
      elegido = -1;
      void clientes.conocer(p.mensajes.slice(0, 5).map((m) => m.de[0]?.correo));
    } catch {
      if (n === pedido) resultados = [];
    } finally {
      if (n === pedido) buscando = false;
    }
  }

  function alEscribir() {
    abierto = true;
    clearTimeout(espera);
    espera = setTimeout(traer, 250);
  }

  function aplicar() {
    abierto = false;
    bandeja.buscar(texto);
    campo.blur();
  }

  function limpiar() {
    texto = "";
    resultados = [];
    bandeja.buscar("");
    campo.focus();
  }

  function chips(c: Parameters<typeof bandeja.ponerChips>[0]) {
    bandeja.ponerChips(c);
    void traer();
  }

  function tecla(e: KeyboardEvent) {
    if (e.key === "Escape") {
      if (abierto) abierto = false;
      else {
        texto = "";
        bandeja.buscar("");
        campo.blur();
      }
    } else if (e.key === "ArrowDown" && resultados.length) {
      e.preventDefault();
      abierto = true;
      elegido = Math.min(elegido + 1, resultados.length - 1);
    } else if (e.key === "ArrowUp" && resultados.length) {
      e.preventDefault();
      elegido = Math.max(elegido - 1, -1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (elegido >= 0 && resultados[elegido]) abrirResultado(resultados[elegido]);
      else aplicar();
    }
  }

  function abrirResultado(m: Resumen) {
    abierto = false;
    bandeja.buscar(texto);
    // La lista se vuelve a pedir con la búsqueda; el mensaje se abre igual.
    queueMicrotask(() => bandeja.abrir(m.uid));
  }

  // El pedazo que coincide, resaltado. Sin tildes y sin mayúsculas, como
  // busca el servidor: «fenolico» encuentra «fenólico».
  const plano = (c: string) => c.normalize("NFD")[0].toLowerCase();
  function resaltar(m: Resumen): { pre: string; hl: string; post: string } {
    const palabras = texto.trim().split(/\s+/).filter(Boolean);
    for (const fuente of [m.asunto, m.vista]) {
      const letras = [...(fuente ?? "")];
      const normal = letras.map(plano).join("");
      for (const p of palabras) {
        const buscada = [...p].map(plano).join("");
        const i = normal.indexOf(buscada);
        if (i < 0) continue;
        const largo = [...buscada].length;
        const desde = fuente === m.vista ? Math.max(0, i - 24) : 0;
        return {
          pre: (desde > 0 ? "…" : "") + letras.slice(desde, i).join(""),
          hl: letras.slice(i, i + largo).join(""),
          post: letras.slice(i + largo).join(""),
        };
      }
    }
    return { pre: m.asunto || "(sin asunto)", hl: "", post: "" };
  }

  function fuera(e: MouseEvent) {
    if (caja && !caja.contains(e.target as Node)) {
      abierto = false;
      menuFecha = false;
      menuDe = false;
    }
    if (!(e.target as HTMLElement).closest(".cuenta")) menuCuenta = false;
  }

  const inicialesCasilla = $derived.by(() => {
    const nombre = preferencias.remitente(bandeja.correo ?? "").nombre;
    if (nombre) return iniciales({ nombre, correo: bandeja.correo ?? "" });
    return (bandeja.correo ?? "?")[0].toUpperCase();
  });

  async function salir() {
    await api.salir().catch(() => {});
    bandeja.correo = null;
  }
</script>

<svelte:window onclick={fuera} />

<header class="barra">
  <div class="marca">
    <button class="icono menu" aria-label="Carpetas" onclick={() => (bandeja.menuAbierto = true)}><Icono nombre="menu" tamano={22} /></button>
    <img src="/logo.png" alt="" width="36" height="36" />
    <div class="nombre"><strong>Correo</strong><span>Maderera JBJ</span></div>
  </div>

  <div class="buscador" class:activo={abierto && texto.trim() !== ""} bind:this={caja}>
    <div class="caja">
      <button class="icono menu-tel" aria-label="Carpetas" onclick={() => (bandeja.menuAbierto = true)}><Icono nombre="menu" tamano={22} /></button>
      <span class="lupa"><Icono nombre="buscar" tamano={20} /></span>
      <label for="buscar" class="oculto">Buscar en el correo</label>
      <input
        id="buscar"
        type="search"
        autocomplete="off"
        placeholder="Buscar en el correo"
        bind:this={campo}
        bind:value={texto}
        oninput={alEscribir}
        onfocus={() => texto.trim() && ((abierto = true), void traer())}
        onkeydown={tecla}
        role="combobox"
        aria-expanded={abierto && texto.trim() !== ""}
        aria-controls="resultados"
      />
      {#if texto}
        <button class="icono" aria-label="Borrar la búsqueda" onclick={limpiar}><Icono nombre="cerrar" tamano={20} /></button>
      {/if}
      <button
        class="icono filtros"
        aria-label="Filtros de búsqueda"
        title="Filtros"
        onclick={() => {
          abierto = !abierto;
          campo.focus();
        }}><Icono nombre="filtros" tamano={20} /></button
      >
      <span class="avatar cuenta-tel" style:width="38px" style:height="38px">{inicialesCasilla}</span>
    </div>

    {#if abierto}
      <div class="panel menu-flotante" id="resultados">
        <div class="chips">
          <div class="chip-con-menu">
            <button class="chip-b" class:on={!!bandeja.chips.de} onclick={() => ((menuDe = !menuDe), (menuFecha = false))}>
              {bandeja.chips.de ? `De ${bandeja.chips.de}` : "De cualquiera"}<Icono nombre="flecha-abajo" tamano={15} />
            </button>
            {#if menuDe}
              <form
                class="submenu menu-flotante de"
                onsubmit={(e) => {
                  e.preventDefault();
                  menuDe = false;
                  chips({ de: textoDe.trim() });
                }}
              >
                <input class="campo" placeholder="Nombre o dirección" bind:value={textoDe} />
                <div class="fila-botones">
                  {#if bandeja.chips.de}<button type="button" class="boton" onclick={() => ((textoDe = ""), (menuDe = false), chips({ de: "" }))}>Cualquiera</button>{/if}
                  <button class="boton principal">Listo</button>
                </div>
              </form>
            {/if}
          </div>
          <div class="chip-con-menu">
            <button class="chip-b" class:on={bandeja.chips.dias > 0} onclick={() => ((menuFecha = !menuFecha), (menuDe = false))}>
              {nombreFecha}<Icono nombre="flecha-abajo" tamano={15} />
            </button>
            {#if menuFecha}
              <div class="submenu menu-flotante">
                {#each fechas as [dias, nombre] (dias)}
                  <button class="item-menu" onclick={() => ((menuFecha = false), chips({ dias }))}>
                    <span style:flex="1">{nombre}</span>
                    {#if bandeja.chips.dias === dias}<Icono nombre="tilde" tamano={17} />{/if}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
          <button class="chip-b" class:on={bandeja.chips.adjuntos} aria-pressed={bandeja.chips.adjuntos} onclick={() => chips({ adjuntos: !bandeja.chips.adjuntos })}>
            Con adjuntos
          </button>
          <span class="donde">en {bandeja.carpetaActual?.nombre ?? "la carpeta"}</span>
        </div>
        {#if texto.trim()}
          {#if buscando && !resultados.length}
            <div class="nada">Buscando…</div>
          {:else if !resultados.length}
            <div class="nada">Nada con «{texto.trim()}» {bandeja.chips.dias || bandeja.chips.adjuntos || bandeja.chips.de ? "con esos filtros" : `en ${bandeja.carpetaActual?.nombre?.toLowerCase() ?? "esta carpeta"}`}.</div>
          {:else}
            {#each resultados as m, i (m.uid)}
              {@const r = resaltar(m)}
              {@const tipo = clientes.tipo(m.de[0]?.correo)}
              <button class="resultado" class:elegido={i === elegido} onmouseenter={() => (elegido = i)} onclick={() => abrirResultado(m)}>
                <span class="avatar {tipo}" style:width="40px" style:height="40px" style:font-size="15px">{iniciales(m.de[0])}</span>
                <span class="texto">
                  <span class="quien"><strong>{nombreDe(m.de[0])}</strong><span>{fechaCorta(m.fecha)}</span></span>
                  <span class="donde-esta">{r.pre}{#if r.hl}<mark>{r.hl}</mark>{/if}{r.post}</span>
                </span>
                {#if m.adjuntos}<Icono nombre="clip" tamano={18} />{/if}
              </button>
            {/each}
            <button class="ver-todos" onclick={aplicar}>
              <Icono nombre="buscar" tamano={18} />
              {totalResultados === 1 ? `Ver el resultado de «${texto.trim()}»` : `Ver los ${totalResultados} resultados de «${texto.trim()}»`}
            </button>
          {/if}
        {:else}
          <div class="nada">Escribí quién, qué o una palabra del correo.</div>
        {/if}
      </div>
    {/if}
  </div>

  <div class="derecha">
    {#if sesion.panel}
      <a class="volver" href={sesion.panel}><Icono nombre="panel" tamano={19} /><span>Volver al panel</span></a>
    {/if}
    <button
      class="icono"
      aria-label={preferencias.oscuro ? "Pasar a claro" : "Pasar a oscuro"}
      title={preferencias.oscuro ? "Pasar a claro" : "Pasar a oscuro"}
      onclick={() => preferencias.alternarTema()}
    >
      <Icono nombre={preferencias.oscuro ? "sol" : "luna"} tamano={21} />
    </button>
    <button
      class="icono"
      class:activo={bandeja.ajustesAbiertos}
      aria-label="Ajustes"
      title="Ajustes"
      onclick={() => (bandeja.ajustesAbiertos = !bandeja.ajustesAbiertos)}><Icono nombre="ajustes" tamano={21} /></button
    >
    <div class="cuenta">
      <button class="avatar yo" aria-label="Tu casilla: {bandeja.correo}" aria-expanded={menuCuenta} onclick={() => (menuCuenta = !menuCuenta)}>
        {inicialesCasilla}
      </button>
      {#if menuCuenta}
        <div class="menu-cuenta menu-flotante">
          <div class="casilla-actual">
            <strong>{preferencias.remitente(bandeja.correo ?? "").nombre || "Tu casilla"}</strong>
            <span>{bandeja.correo}</span>
          </div>
          <button class="item-menu" onclick={() => ((menuCuenta = false), (bandeja.ajustesAbiertos = true))}><Icono nombre="ajustes" />Ajustes</button>
          <button class="item-menu" onclick={salir}><Icono nombre="salir" />Salir</button>
        </div>
      {/if}
    </div>
  </div>
</header>

<style>
  .barra {
    height: 72px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 0 20px;
  }
  .marca {
    width: 236px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 12px;
    padding-left: 6px;
  }
  .marca img {
    border-radius: 8px;
  }
  .nombre {
    display: grid;
    line-height: 1.2;
  }
  .nombre strong {
    font-size: 19px;
    font-weight: 600;
  }
  .nombre span {
    font-size: 14px;
    color: var(--mut);
  }
  .menu,
  .menu-tel,
  .cuenta-tel {
    display: none;
  }
  .buscador {
    position: relative;
    width: 720px;
    min-width: 0;
    flex: 0 1 720px;
  }
  .caja {
    height: 50px;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 4px 0 16px;
    border-radius: 12px;
    background: var(--srch);
    color: var(--mut);
  }
  .buscador.activo .caja,
  .caja:focus-within {
    box-shadow: 0 0 0 2px var(--acc);
  }
  .lupa {
    display: grid;
    margin-right: 8px;
  }
  .caja input {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: 0;
    background: transparent;
    outline: none;
    font-size: 17px;
    color: var(--fg);
  }
  .caja input::placeholder {
    color: var(--mut);
  }
  .caja input::-webkit-search-cancel-button {
    display: none;
  }
  .panel {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    padding: 0;
    overflow: visible;
    z-index: 25;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--ls);
  }
  .chip-con-menu {
    position: relative;
  }
  .chip-b {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 38px;
    padding: 0 14px;
    border-radius: 999px;
    font-size: 15px;
    border: 1px solid var(--ln);
    background: transparent;
    color: var(--fg);
  }
  .chip-b :global(svg) {
    opacity: 0.7;
  }
  .chip-b.on {
    border-color: transparent;
    background: var(--accBg);
    color: var(--accT);
    font-weight: 600;
  }
  .donde {
    margin-left: auto;
    font-size: 14px;
    color: var(--mut);
  }
  .submenu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    min-width: 220px;
  }
  .submenu.de {
    padding: 12px;
    display: grid;
    gap: 10px;
    width: 300px;
  }
  .fila-botones {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .resultado {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    padding: 12px 18px;
    border: 0;
    background: transparent;
    text-align: left;
    color: var(--mut);
  }
  .resultado.elegido {
    background: var(--sel);
  }
  .texto {
    flex: 1;
    min-width: 0;
    display: grid;
    line-height: 1.4;
    color: var(--fg);
  }
  .quien {
    display: flex;
    gap: 10px;
    align-items: baseline;
  }
  .quien strong {
    font-size: 16px;
    font-weight: 600;
  }
  .quien span {
    font-size: 15px;
    color: var(--mut);
  }
  .donde-esta {
    font-size: 16px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  mark {
    background: var(--accBg);
    color: var(--accT);
    font-weight: 600;
    border-radius: 3px;
    padding: 0 2px;
  }
  .ver-todos {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 14px 18px;
    border: 0;
    border-top: 1px solid var(--ls);
    background: transparent;
    font-size: 16px;
    color: var(--accT);
    font-weight: 500;
    text-align: left;
    border-radius: 0 0 14px 14px;
  }
  .ver-todos:hover {
    background: var(--sel);
  }
  .nada {
    padding: 18px;
    color: var(--mut);
    font-size: 16px;
  }
  .derecha {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--mut);
  }
  .volver {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 42px;
    padding: 0 14px;
    border-radius: 10px;
    font-size: 16px;
    color: var(--fg);
    text-decoration: none;
  }
  .volver:hover,
  .icono.activo {
    background: var(--side-act);
  }
  .derecha .icono {
    color: var(--mut);
  }
  .cuenta {
    position: relative;
    margin-left: 6px;
  }
  .avatar.yo {
    width: 40px;
    height: 40px;
    border: 0;
    background: var(--avatar);
    color: #fff;
    font-size: 15px;
  }
  .menu-cuenta {
    position: absolute;
    right: 0;
    top: calc(100% + 8px);
    width: 280px;
  }
  .casilla-actual {
    display: grid;
    padding: 10px 16px 12px;
    border-bottom: 1px solid var(--ls);
    margin-bottom: 6px;
    line-height: 1.35;
  }
  .casilla-actual span {
    color: var(--mut);
    font-size: 15px;
    overflow-wrap: anywhere;
  }

  @media (max-width: 1280px) {
    .volver span {
      display: none;
    }
    .volver {
      width: 42px;
      padding: 0;
      justify-content: center;
    }
  }
  @media (max-width: 1080px) {
    .marca {
      width: auto;
    }
    .menu {
      display: inline-grid;
      margin-left: -10px;
    }
  }
  /* Teléfono (2f): una píldora con el menú, el buscador y la cuenta. */
  @media (max-width: 720px) {
    .barra {
      height: auto;
      padding: 4px 16px 8px;
    }
    .marca,
    .derecha,
    .filtros {
      display: none;
    }
    .buscador {
      flex: 1;
      width: auto;
    }
    .caja {
      height: 52px;
      border-radius: 999px;
      padding: 0 7px 0 4px;
      gap: 6px;
    }
    .menu-tel,
    .cuenta-tel {
      display: inline-flex;
    }
    .menu-tel {
      color: var(--fg);
      width: 44px;
      height: 44px;
      border-radius: 999px;
    }
    .cuenta-tel {
      background: var(--avatar);
      color: #fff;
      font-size: 14px;
    }
    .lupa {
      display: none;
    }
    .panel {
      position: fixed;
      top: 68px;
      left: 0;
      right: 0;
      bottom: 0;
      border-radius: 0;
      box-shadow: none;
      overflow-y: auto;
    }
    .chips {
      flex-wrap: nowrap;
      overflow-x: auto;
      padding: 10px 16px;
    }
    .chip-b {
      flex: none;
    }
    .donde {
      display: none;
    }
  }
</style>
