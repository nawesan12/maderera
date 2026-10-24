<script lang="ts">
  import { bandeja } from "../lib/estado.svelte";
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

<style>
  .avisos {
    position: fixed;
    left: 50%;
    bottom: calc(20px + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    z-index: 50;
    display: grid;
    gap: 8px;
    width: max-content;
    max-width: calc(100vw - 32px);
  }
  .aviso {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 11px 14px 11px 18px;
    border-radius: 12px;
    background: oklch(0.25 0.01 60);
    color: #fff;
    box-shadow: var(--sombra);
    animation: entra 0.18s ease-out;
  }
  .aviso.error {
    background: var(--peligro);
  }
  button {
    border: 0;
    background: transparent;
    color: oklch(0.82 0.13 60);
    font-weight: 700;
    padding: 4px 6px;
    border-radius: 6px;
  }
  button:hover {
    background: #fff2;
  }
  @keyframes entra {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
</style>
