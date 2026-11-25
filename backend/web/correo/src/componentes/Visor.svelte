<script lang="ts">
  import { onMount } from "svelte";
  import { api, type Adjunto, type Conexion, type Mensaje } from "../lib/api";
  import AdjuntoConectado from "./AdjuntoConectado.svelte";
  import { bandeja } from "../lib/estado.svelte";
  import type { Ficha } from "../lib/clientes.svelte";
  import { fechaDelMensaje, nombreDe, tamano, tipoDeAdjunto } from "../lib/formato";
  import Icono from "./Icono.svelte";

  // El visor de fotos (2h) y de PDF (2i): sobre todo, siempre oscuro para
  // que lo de adentro resalte. Flechas para pasar entre adjuntos, zoom y
  // girar en las fotos. El PDF lo dibuja el navegador, sin bajarlo.
  let {
    mensaje,
    adjuntos,
    indice = $bindable(),
    ficha,
    conexiones = [],
  }: { mensaje: Mensaje; adjuntos: Adjunto[]; indice: number | null; ficha: Ficha | null; conexiones?: { adjunto: Adjunto; conexion: Conexion }[] } = $props();

  let zoom = $state(1);
  let giro = $state(0);
  const a = $derived(adjuntos[indice ?? 0]);
  const t = $derived(tipoDeAdjunto(a.tipo, a.nombre));
  const esPDF = $derived(a.tipo === "application/pdf");
  const conexion = $derived(conexiones.find((x) => x.adjunto.indice === a.indice)?.conexion);
  const url = $derived(api.urlAdjunto(bandeja.carpeta, mensaje.uid, a.indice, true));
  let marco: HTMLIFrameElement | undefined = $state();

  function pasar(d: number) {
    if (adjuntos.length < 2) return;
    indice = ((indice ?? 0) + d + adjuntos.length) % adjuntos.length;
    zoom = 1;
    giro = 0;
  }

  function cerrar() {
    indice = null;
  }

  function imprimir() {
    if (esPDF && marco?.contentWindow) {
      try {
        marco.contentWindow.print();
        return;
      } catch {
        // el visor de PDF del navegador no deja: se abre aparte
      }
    }
    window.open(url, "_blank", "noopener");
  }

  onMount(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cerrar();
      } else if (e.key === "ArrowRight") pasar(1);
      else if (e.key === "ArrowLeft") pasar(-1);
      else if ((e.key === "+" || e.key === "=") && !esPDF) zoom = Math.min(zoom + 0.25, 4);
      else if (e.key === "-" && !esPDF) zoom = Math.max(zoom - 0.25, 0.25);
    };
    addEventListener("keydown", tecla, true);
    document.body.style.overflow = "hidden";
    return () => {
      removeEventListener("keydown", tecla, true);
      document.body.style.overflow = "";
    };
  });
</script>

<div class="visor" role="dialog" aria-modal="true" aria-label="Ver {a.nombre}">
  <div class="arriba">
    <button class="redondo" aria-label="Cerrar (Esc)" onclick={cerrar}><Icono nombre="cerrar" tamano={22} /></button>
    <span class="tipo" style:color={esPDF ? "oklch(0.75 0.14 25)" : "oklch(0.78 0.11 250)"}><Icono nombre={t.icono} tamano={24} /></span>
    <div class="titulo">
      <strong>{a.nombre}</strong>
      <span>{tamano(a.tamano)} · de {nombreDe(mensaje.de[0])} · {fechaDelMensaje(mensaje.fecha).toLowerCase()}</span>
    </div>
    <div class="botones">
      {#if !esPDF}
        <span class="grupo">
          <button aria-label="Alejar" onclick={() => (zoom = Math.max(zoom - 0.25, 0.25))}><Icono nombre="alejar" tamano={18} /></button>
          <span class="mono porcentaje">{Math.round(zoom * 100)}%</span>
          <button aria-label="Acercar" onclick={() => (zoom = Math.min(zoom + 0.25, 4))}><Icono nombre="acercar" tamano={18} /></button>
        </span>
        <button class="redondo chico" aria-label="Girar" onclick={() => (giro = (giro + 90) % 360)}><Icono nombre="refrescar" tamano={18} /></button>
      {/if}
      <button class="pildora" onclick={imprimir}><Icono nombre="imprimir" tamano={18} /><span>Imprimir</span></button>
      {#if ficha}
        <a class="pildora" href={ficha.enlaces.ficha} target="_blank" rel="noopener"><Icono nombre="persona" tamano={18} /><span>Ficha de {ficha.nombre}</span></a>
      {/if}
      <a class="pildora clara" href={api.urlAdjunto(bandeja.carpeta, mensaje.uid, a.indice)} download={a.nombre}><Icono nombre="descargar" tamano={18} /><span>Descargar</span></a>
    </div>
  </div>

  <div class="centro">
    {#if esPDF}
      <iframe bind:this={marco} title={a.nombre} src={url}></iframe>
    {:else}
      <div class="lienzo">
        <img src={url} alt={a.nombre} style:transform="scale({zoom}) rotate({giro}deg)" />
      </div>
    {/if}
    {#if conexion}
      <aside class="lado"><AdjuntoConectado {conexion} oscuro /></aside>
    {/if}
    {#if adjuntos.length > 1}
      <button class="flecha izq" aria-label="Anterior" onclick={() => pasar(-1)}><Icono nombre="flecha-izquierda" tamano={26} /></button>
      <button class="flecha der" aria-label="Siguiente" onclick={() => pasar(1)}><Icono nombre="flecha-derecha" tamano={26} /></button>
    {/if}
  </div>

  {#if adjuntos.length > 1}
    <div class="tira">
      {#each adjuntos as x, i (x.indice)}
        {@const tx = tipoDeAdjunto(x.tipo, x.nombre)}
        <button class="miniatura" class:actual={i === indice} onclick={() => ((indice = i), (zoom = 1), (giro = 0))}>
          <span class="cuadro">
            {#if x.tipo.startsWith("image/")}
              <img src={api.urlAdjunto(bandeja.carpeta, mensaje.uid, x.indice, true)} alt="" />
            {:else}
              <span style:color={x.tipo === "application/pdf" ? "oklch(0.75 0.14 25)" : "oklch(0.78 0.12 150)"} style:display="inline-flex"><Icono nombre={tx.icono} tamano={22} /></span>
            {/if}
          </span>
          <span class="nombre">{x.nombre}</span>
        </button>
      {/each}
    </div>
    <div class="ayuda">← → para pasar · Esc para cerrar</div>
  {/if}
</div>

<style>
  .visor {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    flex-direction: column;
    background: oklch(0.14 0.008 60);
    color: #fff;
  }
  .arriba {
    height: 68px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 0 16px 0 12px;
  }
  .redondo {
    width: 46px;
    height: 46px;
    flex: none;
    border: 0;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: oklch(1 0 0 / 0.1);
    color: #fff;
  }
  .redondo.chico {
    width: 44px;
    height: 44px;
  }
  .redondo:hover,
  .pildora:hover,
  .grupo button:hover {
    background: oklch(1 0 0 / 0.18);
  }
  .tipo {
    display: inline-flex;
  }
  .titulo {
    display: grid;
    min-width: 0;
    line-height: 1.3;
  }
  .titulo strong {
    font-size: 17px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .titulo span {
    font-size: 14px;
    color: oklch(1 0 0 / 0.65);
  }
  .botones {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .grupo {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    height: 44px;
    padding: 0 6px;
    border-radius: 999px;
    background: oklch(1 0 0 / 0.1);
  }
  .grupo button {
    width: 34px;
    height: 34px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: #fff;
    display: grid;
    place-items: center;
  }
  .porcentaje {
    font-size: 14px;
    width: 46px;
    text-align: center;
  }
  .pildora {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 44px;
    padding: 0 16px;
    border: 0;
    border-radius: 999px;
    background: oklch(1 0 0 / 0.1);
    color: #fff;
    font-size: 15px;
    font-weight: 500;
    text-decoration: none;
    white-space: nowrap;
  }
  .pildora.clara {
    background: oklch(0.97 0.005 80);
    color: oklch(0.15 0.01 60);
    font-weight: 600;
    padding: 0 18px;
  }
  .pildora.clara:hover {
    background: #fff;
  }
  .centro {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 100px;
  }
  .lienzo {
    width: 100%;
    height: 100%;
    overflow: auto;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .lienzo img {
    max-width: 100%;
    max-height: 100%;
    border-radius: 4px;
    box-shadow: 0 30px 80px -20px rgb(0 0 0 / 0.7);
    transition: transform 0.15s ease;
  }
  iframe {
    width: min(900px, 100%);
    height: calc(100% - 16px);
    border: 0;
    border-radius: 4px;
    background: #fff;
    box-shadow: 0 30px 80px -20px rgb(0 0 0 / 0.7);
  }
  .lado {
    width: 320px;
    flex: none;
    align-self: flex-start;
    margin-left: 24px;
    max-height: 100%;
    overflow-y: auto;
  }
  .flecha {
    position: absolute;
    top: 50%;
    width: 56px;
    height: 56px;
    margin-top: -28px;
    border: 0;
    border-radius: 50%;
    background: oklch(1 0 0 / 0.12);
    color: #fff;
    display: grid;
    place-items: center;
  }
  .flecha:hover {
    background: oklch(1 0 0 / 0.2);
  }
  .izq {
    left: 28px;
  }
  .der {
    right: 28px;
  }
  .tira {
    height: 112px;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    overflow-x: auto;
  }
  .miniatura {
    width: 120px;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: center;
    border: 0;
    background: transparent;
    color: #fff;
    opacity: 0.55;
    padding: 0;
  }
  .miniatura.actual,
  .miniatura:hover {
    opacity: 1;
  }
  .cuadro {
    width: 120px;
    height: 68px;
    border-radius: 8px;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    background: repeating-linear-gradient(135deg, oklch(0.32 0.01 60) 0 6px, oklch(0.28 0.01 60) 6px 12px);
  }
  .miniatura.actual .cuadro {
    box-shadow: 0 0 0 3px oklch(0.68 0.19 48);
  }
  .cuadro img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .nombre {
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 120px;
  }
  .ayuda {
    position: absolute;
    left: 50%;
    bottom: 122px;
    transform: translateX(-50%);
    font-size: 14px;
    color: oklch(1 0 0 / 0.6);
    pointer-events: none;
  }
  @media (max-width: 900px) {
    .pildora span {
      display: none;
    }
    .pildora {
      width: 44px;
      padding: 0;
      justify-content: center;
    }
    .centro {
      padding: 0 8px;
    }
    .flecha {
      width: 48px;
      height: 48px;
    }
    .izq {
      left: 8px;
    }
    .der {
      right: 8px;
    }
    .ayuda,
    .grupo,
    .lado {
      display: none;
    }
  }
</style>
