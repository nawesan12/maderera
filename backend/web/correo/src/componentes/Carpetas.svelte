<script lang="ts">
  import { api, type Rol } from "../lib/api";
  import { bandeja } from "../lib/estado.svelte";
  import Icono, { type NombreIcono } from "./Icono.svelte";

  let { onatajos }: { onatajos: () => void } = $props();

  const iconos: Record<Rol, NombreIcono> = {
    entrada: "entrada",
    enviados: "enviados",
    borradores: "borradores",
    papelera: "papelera",
    spam: "spam",
    archivo: "archivo",
    "": "carpeta",
  };

  async function salir() {
    await api.salir().catch(() => {});
    bandeja.correo = null;
  }
</script>

{#if bandeja.menuAbierto}
  <button class="velo" aria-label="Cerrar el menú" onclick={() => (bandeja.menuAbierto = false)}></button>
{/if}

<nav class="carpetas" class:visible={bandeja.menuAbierto} aria-label="Carpetas">
  <div class="arriba">
    <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"
      ><rect width="32" height="32" rx="8" fill="var(--naranja)" /><path
        d="M7 11l9 6 9-6M7 10h18v12H7z"
        fill="none"
        stroke="#fff"
        stroke-width="2.2"
        stroke-linejoin="round"
      /></svg
    >
    <div class="quien">
      <strong>Correo</strong>
      <span title={bandeja.correo ?? ""}>{bandeja.correo}</span>
    </div>
  </div>

  <button class="boton principal redactar" onclick={() => bandeja.redactar("nuevo")}>
    <Icono nombre="lapiz" /> Redactar <span class="tecla">c</span>
  </button>

  <ul>
    {#each bandeja.carpetas as c (c.ruta)}
      <li>
        <button
          class:actual={c.ruta === bandeja.carpeta}
          aria-current={c.ruta === bandeja.carpeta ? "page" : undefined}
          onclick={() => bandeja.irACarpeta(c.ruta)}
        >
          <Icono nombre={iconos[c.rol ?? ""]} />
          <span class="nombre">{c.nombre}</span>
          {#if c.noLeidos && c.rol !== "enviados" && c.rol !== "papelera"}
            <span class="cuenta" aria-label="{c.noLeidos} sin leer">{c.noLeidos}</span>
          {/if}
        </button>
      </li>
    {/each}
  </ul>

  <div class="abajo">
    <button class="icono" title="Atajos de teclado (?)" onclick={onatajos}><span class="tecla">?</span></button>
    <button class="boton" onclick={salir}><Icono nombre="salir" /> Salir</button>
  </div>
</nav>

<style>
  .carpetas {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px 12px;
    background: var(--superficie-2);
    border-right: 1px solid var(--borde);
    overflow-y: auto;
    min-width: 0;
  }
  .arriba {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 0 6px;
  }
  .quien {
    display: grid;
    min-width: 0;
  }
  .quien span {
    font-size: 0.82rem;
    color: var(--texto-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .redactar {
    justify-content: center;
    padding: 0.7em;
    border-radius: 12px;
  }
  .redactar .tecla {
    border-color: #fff6;
    color: #fff;
    background: transparent;
    margin-left: auto;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  li button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    border: 0;
    background: transparent;
    padding: 9px 10px;
    border-radius: 9px;
    color: var(--texto-2);
    text-align: left;
    font-weight: 500;
  }
  li button:hover {
    background: var(--borde);
    color: var(--texto);
  }
  li button.actual {
    background: var(--seleccion);
    color: var(--texto);
    font-weight: 650;
  }
  .nombre {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cuenta {
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--naranja-fuerte);
  }
  .abajo {
    margin-top: auto;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .velo {
    display: none;
  }

  @media (max-width: 1080px) {
    .carpetas {
      position: fixed;
      inset: 0 auto 0 0;
      width: min(290px, 84vw);
      z-index: 30;
      transform: translateX(-100%);
      transition: transform 0.2s ease;
      box-shadow: var(--sombra);
    }
    .carpetas.visible {
      transform: none;
    }
    .velo {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 29;
      border: 0;
      background: oklch(0.2 0.01 60 / 0.35);
    }
  }
</style>
