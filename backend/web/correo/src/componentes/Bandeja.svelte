<script lang="ts">
  import { onMount } from "svelte";
  import { bandeja } from "../lib/estado.svelte";
  import Carpetas from "./Carpetas.svelte";
  import Lista from "./Lista.svelte";
  import Lector from "./Lector.svelte";
  import Redactar from "./Redactar.svelte";
  import Avisos from "./Avisos.svelte";
  import Atajos from "./Atajos.svelte";

  let verAtajos = $state(false);

  onMount(() => {
    void bandeja.iniciar();
    // Sin IDLE ni push todavía: cada minuto, y al volver a la pestaña.
    const reloj = setInterval(() => void bandeja.refrescar(), 60_000);
    const alVolver = () => {
      if (!document.hidden) void bandeja.refrescar();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      clearInterval(reloj);
      document.removeEventListener("visibilitychange", alVolver);
    };
  });

  // Los atajos: los de Gmail, que son los que la gente ya conoce. Nunca
  // mientras se escribe en un campo.
  function tecla(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (bandeja.redaccion) return;
    const m = bandeja.abierto;
    const acciones: Record<string, () => void> = {
      j: () => bandeja.moverFoco(1),
      k: () => bandeja.moverFoco(-1),
      ArrowDown: () => bandeja.moverFoco(1),
      ArrowUp: () => bandeja.moverFoco(-1),
      Enter: () => bandeja.foco && !bandeja.uidAbierto && bandeja.abrir(bandeja.foco),
      o: () => bandeja.foco && bandeja.abrir(bandeja.foco),
      u: () => bandeja.cerrar(),
      Escape: () => (verAtajos ? (verAtajos = false) : bandeja.cerrar()),
      c: () => bandeja.redactar("nuevo"),
      r: () => m && bandeja.redactar("responder", m),
      a: () => m && bandeja.redactar("responder-todos", m),
      f: () => m && bandeja.redactar("reenviar", m),
      e: () => bandeja.accion(bandeja.rolActual === "archivo" ? "restaurar" : "archivar"),
      "#": () => bandeja.accion("papelera"),
      Delete: () => bandeja.accion("papelera"),
      "!": () => bandeja.accion("spam"),
      s: () => {
        const uids = bandeja.objetivo();
        const fila = bandeja.mensajes.find((x) => x.uid === uids[0]);
        void bandeja.accion(fila?.destacado || m?.destacado ? "no-destacar" : "destacar", uids);
      },
      x: () => bandeja.foco && bandeja.marcar(bandeja.foco),
      I: () => bandeja.accion("leido"),
      U: () => bandeja.accion("no-leido"),
      "/": () => document.querySelector<HTMLInputElement>("#buscar")?.focus(),
      "?": () => (verAtajos = !verAtajos),
    };
    const hacer = acciones[e.key];
    if (hacer) {
      e.preventDefault();
      hacer();
    }
  }
</script>

<svelte:window onkeydown={tecla} />

<div class="bandeja" class:abierto={bandeja.uidAbierto !== null}>
  <Carpetas onatajos={() => (verAtajos = true)} />
  <Lista />
  <Lector />
</div>

{#if bandeja.redaccion}
  <Redactar />
{/if}
{#if verAtajos}
  <Atajos oncerrar={() => (verAtajos = false)} />
{/if}
<Avisos />

<style>
  .bandeja {
    height: 100%;
    display: grid;
    grid-template-columns: 236px minmax(340px, 420px) 1fr;
    overflow: hidden;
  }
  /* Tableta: las carpetas van a un cajón; lista y lectura lado a lado. */
  @media (max-width: 1080px) {
    .bandeja {
      grid-template-columns: minmax(300px, 380px) 1fr;
    }
  }
  /* Teléfono: un panel por vez. */
  @media (max-width: 720px) {
    .bandeja {
      grid-template-columns: 1fr;
    }
    .bandeja.abierto :global(.lista) {
      display: none;
    }
    .bandeja:not(.abierto) :global(.lector) {
      display: none;
    }
  }
</style>
