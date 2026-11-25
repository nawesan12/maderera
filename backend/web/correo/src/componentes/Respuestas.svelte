<script lang="ts">
  import { onMount } from "svelte";
  import { equipo } from "../lib/equipo.svelte";
  import { bandeja } from "../lib/estado.svelte";
  import Icono from "./Icono.svelte";

  // El botón «Respuestas» (2p) y el aviso de seguimiento, al pie de
  // redactar y de responder en línea. Solo con la casilla del equipo.
  let {
    oninsertar,
    seguimiento = $bindable(0),
    compacto = false,
  }: { oninsertar: (texto: string, titulo: string) => void; seguimiento?: number; compacto?: boolean } = $props();

  let abierto = $state(false);
  let menuSeguir = $state(false);
  let raiz = $state<HTMLDivElement>();

  onMount(() => {
    const fuera = (e: MouseEvent) => {
      if (raiz && !raiz.contains(e.target as Node)) {
        abierto = false;
        menuSeguir = false;
      }
    };
    addEventListener("click", fuera);
    return () => removeEventListener("click", fuera);
  });

  const dias = [0, 2, 3, 5, 7, 15];
</script>

{#if equipo.activo}
  <div class="herramientas" bind:this={raiz}>
    <div class="con-menu">
      <button type="button" class="herramienta" aria-expanded={abierto} onclick={() => ((abierto = !abierto), (menuSeguir = false))} title="Respuestas guardadas">
        <Icono nombre="respuestas" tamano={20} /><span class:oculto={compacto}>Respuestas</span>
      </button>
      {#if abierto}
        <div class="menu menu-flotante">
          {#each equipo.plantillas as p (p.id)}
            <button
              type="button"
              class="item-menu plantilla"
              onclick={() => {
                abierto = false;
                oninsertar(p.texto, p.titulo);
              }}
            >
              <span class="titulo">{p.titulo}</span>
              {#if p.atajo}<span class="atajo mono">{p.atajo}</span>{/if}
              <span class="texto">{p.texto}</span>
            </button>
          {:else}
            <p class="vacio">Todavía no hay respuestas guardadas.</p>
          {/each}
          <button
            type="button"
            class="item-menu nueva"
            onclick={() => {
              abierto = false;
              bandeja.ajustesAbiertos = true;
            }}><Icono nombre="mas_uno" tamano={17} />Armar una en Ajustes</button
          >
        </div>
      {/if}
    </div>
    <div class="con-menu">
      <button type="button" class="herramienta" class:on={seguimiento > 0} aria-expanded={menuSeguir} onclick={() => ((menuSeguir = !menuSeguir), (abierto = false))} title="Avisame si no contesta">
        <Icono nombre="reloj" tamano={20} /><span class:oculto={compacto && !seguimiento}>{seguimiento ? `Aviso en ${seguimiento} días` : "Seguimiento"}</span>
      </button>
      {#if menuSeguir}
        <div class="menu menu-flotante seguir">
          <p class="vacio">Si no contesta en…</p>
          {#each dias as d (d)}
            <button
              type="button"
              class="item-menu"
              onclick={() => {
                seguimiento = d;
                menuSeguir = false;
              }}
            >
              <span style:flex="1">{d === 0 ? "No avisar" : `${d} días, avisame`}</span>
              {#if seguimiento === d}<Icono nombre="tilde" tamano={17} />{/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .herramientas {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .con-menu {
    position: relative;
  }
  .herramienta {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 44px;
    padding: 0 12px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    font-size: 15px;
    white-space: nowrap;
  }
  .herramienta :global(svg) {
    color: var(--mut);
  }
  .herramienta:hover {
    background: var(--sel);
  }
  .herramienta.on {
    color: var(--accT);
    font-weight: 600;
  }
  .herramienta.on :global(svg) {
    color: var(--accT);
  }
  .menu {
    position: absolute;
    bottom: calc(100% + 6px);
    right: 0;
    width: min(340px, calc(100vw - 32px));
    max-height: 420px;
    overflow-y: auto;
  }
  .seguir {
    width: 240px;
  }
  .plantilla {
    flex-wrap: wrap;
    gap: 2px 10px;
    padding: 10px 16px;
  }
  .titulo {
    flex: 1;
    font-weight: 600;
  }
  .atajo {
    font-size: 13px;
    color: var(--mut);
    padding: 1px 8px;
    border-radius: 6px;
    background: var(--hun);
  }
  .texto {
    width: 100%;
    font-size: 14px;
    color: var(--mut);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .vacio {
    margin: 0;
    padding: 10px 16px;
    font-size: 14px;
    color: var(--mut);
  }
  .nueva {
    border-top: 1px solid var(--ls);
    color: var(--accT);
    font-weight: 600;
    font-size: 15px;
  }
</style>
