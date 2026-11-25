<script lang="ts">
  import { bandeja } from "../lib/estado.svelte";
  import { bajada } from "./Descargas.svelte";
  import Icono from "./Icono.svelte";
</script>

<div class="avisos" aria-live="polite">
  {#each bandeja.avisos as a (a.id)}
    <div class="aviso" class:error={a.error} role={a.error ? "alert" : "status"}>
      <span>{a.texto}</span>
      {#if a.deshacer}
        <button
          onclick={() => {
            a.deshacer?.();
            bandeja.quitarAviso(a.id);
          }}>Deshacer</button
        >
      {/if}
    </div>
  {/each}
</div>

{#if bajada.activa}
  <div class="bajada" role="status">
    <div class="que">
      <Icono nombre="bajar-carpeta" tamano={20} />
      <span>Bajando {bajada.nombre}</span>
      {#if bajada.progreso >= 0}<span class="mono">{Math.round(bajada.progreso * 100)}%</span>{/if}
    </div>
    <div class="barra"><span class:indeterminada={bajada.progreso < 0} style:width={bajada.progreso >= 0 ? `${bajada.progreso * 100}%` : undefined}></span></div>
  </div>
{/if}

<style>
  .avisos {
    position: fixed;
    left: 50%;
    bottom: calc(24px + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    z-index: 70;
    display: grid;
    gap: 8px;
    width: max-content;
    max-width: calc(100vw - 32px);
  }
  .aviso {
    display: flex;
    align-items: center;
    gap: 16px;
    min-height: 48px;
    padding: 6px 8px 6px 18px;
    border-radius: 12px;
    background: var(--toast);
    color: var(--toastT);
    box-shadow: var(--popsh);
    font-size: 16px;
    animation: entra 0.18s ease-out;
  }
  .aviso.error {
    background: var(--prT);
    color: #fff;
  }
  button {
    min-height: 36px;
    border: 0;
    background: transparent;
    color: oklch(0.8 0.13 55);
    font-weight: 600;
    padding: 0 10px;
    border-radius: 8px;
  }
  button:hover {
    background: oklch(1 0 0 / 0.12);
  }
  .bajada {
    position: fixed;
    left: 24px;
    bottom: calc(24px + env(safe-area-inset-bottom));
    z-index: 70;
    width: 380px;
    max-width: calc(100vw - 48px);
    padding: 14px 16px;
    border-radius: 14px;
    background: var(--toast);
    color: var(--toastT);
    box-shadow: var(--popsh);
  }
  .que {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 15px;
  }
  .que span:first-of-type {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mono {
    font-size: 14px;
  }
  .barra {
    margin-top: 10px;
    height: 5px;
    border-radius: 3px;
    background: oklch(1 0 0 / 0.15);
    overflow: hidden;
  }
  .barra span {
    display: block;
    height: 100%;
    border-radius: 3px;
    background: oklch(0.75 0.15 55);
    transition: width 0.15s;
  }
  .barra .indeterminada {
    width: 34%;
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
  @keyframes entra {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
</style>
