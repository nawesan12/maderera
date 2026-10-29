<script lang="ts">
  import { onMount } from "svelte";
  import { api, sesionCerrada } from "./lib/api";
  import { bandeja } from "./lib/estado.svelte";
  import { sesion } from "./lib/sesion.svelte";
  import "./lib/preferencias.svelte";
  import { ponerTextura } from "./lib/textura";
  import Entrar from "./componentes/Entrar.svelte";
  import Bandeja from "./componentes/Bandeja.svelte";

  let listo = $state(false);
  ponerTextura();

  onMount(() => {
    api
      .sesion()
      .then((s) => {
        sesion.tomar(s);
        bandeja.correo = s.correo;
      })
      .catch(() => (bandeja.correo = null))
      .finally(() => (listo = true));
    const cerrar = () => (bandeja.correo = null);
    sesionCerrada.addEventListener("cerrada", cerrar);
    return () => sesionCerrada.removeEventListener("cerrada", cerrar);
  });
</script>

{#if !listo}
  <div class="cargando" aria-busy="true"></div>
{:else if bandeja.correo}
  <Bandeja />
{:else}
  <Entrar />
{/if}

<style>
  .cargando {
    height: 100%;
    background-color: var(--side);
    background-image: var(--tex);
    background-size: var(--texS);
  }
</style>
