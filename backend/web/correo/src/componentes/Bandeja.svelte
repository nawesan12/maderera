<script lang="ts">
  import { onMount } from "svelte";
  import { bandeja } from "../lib/estado.svelte";
  import Barra from "./Barra.svelte";
  import Carpetas from "./Carpetas.svelte";
  import Lista from "./Lista.svelte";
  import Lector from "./Lector.svelte";
  import Redactar from "./Redactar.svelte";
  import Avisos from "./Avisos.svelte";
  import Atajos from "./Atajos.svelte";
  import Ajustes from "./Ajustes.svelte";
  import Icono from "./Icono.svelte";

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
    if (t.closest("input, textarea, select, [contenteditable], [role=dialog]") || e.metaKey || e.ctrlKey || e.altKey) return;
    const m = bandeja.abierto;
    const acciones: Record<string, () => void> = {
      j: () => bandeja.moverFoco(1),
      k: () => bandeja.moverFoco(-1),
      ArrowDown: () => bandeja.moverFoco(1),
      ArrowUp: () => bandeja.moverFoco(-1),
      Enter: () => bandeja.foco && !bandeja.uidAbierto && bandeja.abrir(bandeja.foco),
      o: () => bandeja.foco && bandeja.abrir(bandeja.foco),
      u: () => bandeja.cerrar(),
      Escape: () => {
        if (verAtajos) verAtajos = false;
        else if (bandeja.menuAbierto) bandeja.menuAbierto = false;
        else if (bandeja.ajustesAbiertos) bandeja.ajustesAbiertos = false;
        else bandeja.cerrar();
      },
      c: () => bandeja.redactar("nuevo"),
      r: () => m && bandeja.responderEnLinea("responder", m),
      a: () => m && bandeja.responderEnLinea("responder-todos", m),
      f: () => m && bandeja.responderEnLinea("reenviar", m),
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

<div class="marco" class:abierto={bandeja.uidAbierto !== null}>
  <Barra />
  {#if bandeja.sinConexion}
    <div class="franja" role="status">
      <Icono nombre="sin-red" tamano={18} />
      <span class="que">Sin conexión. Podés leer lo que ya estaba descargado.</span>
      {#if bandeja.cola.length}
        <span class="cola">{bandeja.cola.length === 1 ? "1 correo espera para salir" : `${bandeja.cola.length} correos esperan para salir`}</span>
      {/if}
      <button class="reintentar" onclick={() => bandeja.reintentarCola()}>Reintentar</button>
    </div>
  {/if}
  <div class="cuerpo">
    <Carpetas onatajos={() => (verAtajos = true)} />
    {#if bandeja.ajustesAbiertos}
      <Ajustes onatajos={() => (verAtajos = true)} />
    {:else}
      <main class="tarjeta">
        <Lista />
        <Lector />
      </main>
    {/if}
  </div>
</div>

<div class="ventanas" class:con-abierta={bandeja.ventanas.some((v) => !v.minimizada)}>
  {#each bandeja.ventanas.filter((v) => v.minimizada) as v (v.id)}
    <div class="pestana-ventana">
      <button class="titulo-ventana" onclick={() => bandeja.alternarVentana(v.id)} title="Abrir">
        {v.titulo || "Mensaje nuevo"}
      </button>
      <button class="icono chico" aria-label="Abrir" onclick={() => bandeja.alternarVentana(v.id)}><Icono nombre="flecha-arriba" tamano={20} /></button>
      <button class="icono chico" aria-label="Cerrar" onclick={() => bandeja.cerrarVentana(v.id)}><Icono nombre="cerrar" tamano={20} /></button>
    </div>
  {/each}
</div>
{#each bandeja.ventanas as v (v.id)}
  <Redactar ventana={v} />
{/each}
{#if verAtajos}
  <Atajos oncerrar={() => (verAtajos = false)} />
{/if}
<Avisos />

<style>
  .marco {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background-color: var(--side);
    background-image: var(--tex);
    background-size: var(--texS);
  }
  .franja {
    margin: 0 16px 10px 288px;
    min-height: 42px;
    flex: none;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px 10px;
    padding: 4px 8px 4px 16px;
    border-radius: 10px;
    background: var(--toast);
    color: var(--toastT);
    font-size: 15px;
  }
  .que {
    flex: 1;
  }
  .cola {
    opacity: 0.75;
  }
  .reintentar {
    min-height: 34px;
    padding: 0 12px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: oklch(0.8 0.13 55);
    font-weight: 600;
  }
  .reintentar:hover {
    background: oklch(1 0 0 / 0.1);
  }
  .cuerpo {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .tarjeta {
    flex: 1;
    min-width: 0;
    margin: 0 16px 16px 0;
    display: grid;
    grid-template-columns: 460px minmax(0, 1fr);
    background-color: var(--card);
    background-image: var(--texC);
    background-size: 180px 180px;
    border-radius: 14px;
    overflow: hidden;
    box-shadow: var(--sh);
  }

  /* Las ventanas minimizadas, como pestañas abajo a la derecha (2b). */
  .ventanas {
    position: fixed;
    right: 24px;
    bottom: 0;
    z-index: 38;
    display: flex;
    flex-direction: row-reverse;
    gap: 8px;
    pointer-events: none;
  }
  .ventanas.con-abierta {
    right: 704px;
  }
  .pestana-ventana {
    pointer-events: auto;
    width: 300px;
    height: 50px;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 6px 0 18px;
    background: var(--toast);
    color: var(--toastT);
    border-radius: 12px 12px 0 0;
    box-shadow: var(--popsh);
    font-size: 16px;
    font-weight: 500;
  }
  .titulo-ventana {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: 0;
    background: transparent;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 500;
  }
  .icono.chico {
    width: 38px;
    height: 38px;
    color: inherit;
  }
  .icono.chico:hover {
    background: oklch(1 0 0 / 0.12);
    color: inherit;
  }

  @media (max-width: 1280px) {
    .tarjeta {
      grid-template-columns: 380px minmax(0, 1fr);
    }
  }
  @media (max-width: 1080px) {
    .franja {
      margin-left: 16px;
    }
    .tarjeta {
      margin-left: 16px;
      grid-template-columns: minmax(300px, 360px) minmax(0, 1fr);
    }
  }
  /* Teléfono: un panel por vez, sin el marco de madera. */
  @media (max-width: 720px) {
    .marco {
      background: var(--card);
    }
    .franja {
      margin: 0 12px 8px;
    }
    .tarjeta {
      margin: 0;
      border-radius: 0;
      box-shadow: none;
      grid-template-columns: 1fr;
      background-image: none;
    }
    .marco.abierto :global(.lista) {
      display: none;
    }
    .marco:not(.abierto) :global(.lector) {
      display: none;
    }
    .marco.abierto :global(.barra) {
      display: none;
    }
    .ventanas,
    .ventanas.con-abierta {
      right: 12px;
      left: 12px;
      flex-direction: column;
    }
    .pestana-ventana {
      width: 100%;
      border-radius: 12px;
      margin-bottom: 8px;
    }
  }
</style>
