<script lang="ts">
  import { onMount } from "svelte";
  import type { Mensaje } from "../lib/api";
  import { bandeja } from "../lib/estado.svelte";
  import { colorDe, etiquetasDeSiempre, guardarPropia, propias } from "../lib/etiquetas";
  import Icono from "./Icono.svelte";

  // El menú de los tres puntos (2n): marcar, etiquetar con casillas de
  // colores (o crear una escribiéndola), mover a otra carpeta, imprimir.
  let { mensaje, oncerrar }: { mensaje: Mensaje; oncerrar: () => void } = $props();

  let sub = $state<"" | "etiquetas" | "mover">("");
  let buscar = $state("");
  let raiz: HTMLDivElement;

  onMount(() => {
    const fuera = (e: MouseEvent) => {
      if (!raiz.contains(e.target as Node)) oncerrar();
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (sub) sub = "";
        else oncerrar();
      }
    };
    // En el próximo ciclo: el clic que abrió el menú no lo tiene que cerrar.
    const t = setTimeout(() => addEventListener("click", fuera));
    addEventListener("keydown", tecla, true);
    return () => {
      clearTimeout(t);
      removeEventListener("click", fuera);
      removeEventListener("keydown", tecla, true);
    };
  });

  const puestas = $derived(new Set(mensaje.etiquetas ?? []));
  const todas = $derived.by(() => {
    const enUso = bandeja.mensajes.flatMap((m) => m.etiquetas ?? []);
    const nombres = [...etiquetasDeSiempre.map(([n]) => n), ...propias(), ...enUso, ...(mensaje.etiquetas ?? [])];
    const vistos = new Map<string, string>();
    for (const n of nombres) if (!vistos.has(n.toLowerCase())) vistos.set(n.toLowerCase(), n);
    return [...vistos.values()];
  });
  const filtradas = $derived(todas.filter((n) => n.toLowerCase().includes(buscar.trim().toLowerCase())));
  const nueva = $derived(buscar.trim() && !todas.some((n) => n.toLowerCase() === buscar.trim().toLowerCase()) ? buscar.trim() : "");

  function alternar(nombre: string) {
    void bandeja.etiquetar(nombre, !puestas.has(nombre), [mensaje.uid]);
  }

  function crear() {
    if (!nueva) return;
    guardarPropia(nueva);
    void bandeja.etiquetar(nueva, true, [mensaje.uid]);
    buscar = "";
  }

  const destinos = $derived(bandeja.carpetas.filter((c) => c.ruta !== bandeja.carpeta));
  const enSpam = $derived(bandeja.rolActual === "spam");

  function hacer(f: () => void) {
    f();
    oncerrar();
  }
</script>

<div class="raiz" bind:this={raiz}>
  <div class="menu menu-flotante" role="menu">
    <button class="item-menu" role="menuitem" onclick={() => hacer(() => (void bandeja.accion("no-leido", [mensaje.uid]), bandeja.cerrar()))}>
      <Icono nombre="sobre" tamano={19} /><span>Marcar como no leído</span>
    </button>
    <button class="item-menu" role="menuitem" onclick={() => hacer(() => void bandeja.accion(mensaje.destacado ? "no-destacar" : "destacar", [mensaje.uid]))}>
      <Icono nombre="estrella" tamano={19} /><span>{mensaje.destacado ? "Quitar de destacados" : "Destacar"}</span>
    </button>
    <button class="item-menu" class:sel={sub === "etiquetas"} role="menuitem" aria-haspopup="true" aria-expanded={sub === "etiquetas"} onclick={() => (sub = sub === "etiquetas" ? "" : "etiquetas")}>
      <Icono nombre="etiqueta" tamano={19} /><span>Etiquetar</span><Icono nombre="flecha-derecha" tamano={17} />
    </button>
    <button class="item-menu" class:sel={sub === "mover"} role="menuitem" aria-haspopup="true" aria-expanded={sub === "mover"} onclick={() => (sub = sub === "mover" ? "" : "mover")}>
      <Icono nombre="mover" tamano={19} /><span>Mover a</span><Icono nombre="flecha-derecha" tamano={17} />
    </button>
    <button class="item-menu" role="menuitem" onclick={() => hacer(() => window.print())}>
      <Icono nombre="imprimir" tamano={19} /><span>Imprimir</span>
    </button>
    <button class="item-menu" role="menuitem" onclick={() => hacer(() => void bandeja.accion(enSpam ? "restaurar" : "spam", [mensaje.uid]))}>
      <Icono nombre={enSpam ? "entrada" : "bloquear"} tamano={19} /><span>{enSpam ? "No es spam" : "Es spam"}</span>
    </button>
  </div>

  {#if sub === "etiquetas"}
    <div class="sub menu-flotante etiquetas">
      <form
        class="buscar"
        onsubmit={(e) => {
          e.preventDefault();
          if (nueva) crear();
          else if (filtradas[0]) alternar(filtradas[0]);
        }}
      >
        <Icono nombre="buscar" tamano={17} />
        <!-- svelte-ignore a11y_autofocus -->
        <input placeholder="Buscar o crear etiqueta" bind:value={buscar} autofocus maxlength="40" />
      </form>
      <div class="opciones">
        {#each filtradas as n (n)}
          <button class="item-menu fila-etiqueta" role="menuitemcheckbox" aria-checked={puestas.has(n)} onclick={() => alternar(n)}>
            <span class="casilla" class:marcada={puestas.has(n)}>{#if puestas.has(n)}<Icono nombre="tilde" tamano={15} />{/if}</span>
            <span class="punto" style:background={colorDe(n)}></span>
            <span>{n}</span>
          </button>
        {/each}
      </div>
      {#if nueva}
        <button class="crear" onclick={crear}><Icono nombre="mas_uno" tamano={16} />Crear «{nueva}»</button>
      {:else}
        <div class="ayuda">Escribí un nombre para crear una etiqueta.</div>
      {/if}
    </div>
  {:else if sub === "mover"}
    <div class="sub menu-flotante">
      {#each destinos as c (c.ruta)}
        <button class="item-menu" onclick={() => hacer(() => void bandeja.accion("mover", [mensaje.uid], c.ruta))}>
          <Icono nombre="carpeta" tamano={18} /><span>{c.nombre}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .raiz {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 20;
  }
  .menu {
    width: 270px;
  }
  .item-menu span {
    flex: 1;
  }
  .item-menu.sel {
    background: var(--sel);
  }
  .sub {
    position: absolute;
    top: 86px;
    right: calc(100% + 8px);
    width: 300px;
    max-height: 70vh;
    overflow-y: auto;
  }
  .etiquetas {
    padding: 0;
  }
  .buscar {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 52px;
    padding: 0 16px;
    border-bottom: 1px solid var(--ls);
    color: var(--mut);
  }
  .buscar input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    outline: none;
    font-size: 16px;
    color: var(--fg);
  }
  .opciones {
    padding: 6px 0;
  }
  .fila-etiqueta {
    min-height: 44px;
  }
  .punto {
    width: 10px;
    height: 10px;
    flex: none !important;
    border-radius: 3px;
  }
  .crear {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 12px 16px;
    border: 0;
    border-top: 1px solid var(--ls);
    background: transparent;
    font-size: 15px;
    font-weight: 600;
    color: var(--accT);
    text-align: left;
  }
  .crear:hover {
    background: var(--sel);
  }
  .ayuda {
    padding: 12px 16px;
    border-top: 1px solid var(--ls);
    font-size: 14px;
    color: var(--mut);
  }
  @media (max-width: 720px) {
    .sub {
      position: fixed;
      top: auto;
      right: 12px;
      left: 12px;
      bottom: 12px;
      width: auto;
    }
  }
</style>
