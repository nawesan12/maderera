<script lang="ts">
  import { api, type Carpeta, type Rol } from "../lib/api";
  import { bandeja } from "../lib/estado.svelte";
  import { preferencias } from "../lib/preferencias.svelte";
  import { sesion } from "../lib/sesion.svelte";
  import Icono, { type NombreIcono } from "./Icono.svelte";

  let { onatajos }: { onatajos: () => void } = $props();

  // Cada carpeta con su ícono y el tono de su cuadradito (--sqNN en app.css).
  const estilo: Record<Rol, [NombreIcono, number]> = {
    entrada: ["entrada", 45],
    enviados: ["enviados", 250],
    borradores: ["borradores", 60],
    archivo: ["archivo", 150],
    spam: ["spam", 25],
    papelera: ["papelera", 60],
    "": ["carpeta", 300],
  };
  // El orden del diseño, y las carpetas propias al final por nombre.
  const orden: Rol[] = ["entrada", "enviados", "borradores", "archivo", "spam", "papelera", ""];
  const lista = $derived(
    [...bandeja.carpetas].sort(
      (a, b) => orden.indexOf(a.rol ?? "") - orden.indexOf(b.rol ?? "") || a.nombre.localeCompare(b.nombre, "es"),
    ),
  );

  // Lo que dice el número: sin leer en la entrada y las propias, cuántos
  // borradores hay. En enviados y papelera no importa.
  function cuenta(c: Carpeta): number {
    if (c.rol === "borradores") return c.total;
    if (c.rol === "enviados" || c.rol === "papelera" || c.rol === "spam" || c.rol === "archivo") return 0;
    return c.noLeidos;
  }

  const casilla = $derived(bandeja.correo ?? "");
  const nombreCasilla = $derived.by(() => {
    const n = preferencias.remitente(casilla).nombre;
    if (n) return n;
    const local = casilla.split("@")[0] ?? "";
    return local.charAt(0).toUpperCase() + local.slice(1);
  });
  const corto = $derived(casilla.replace(/@.*/, "@"));

  async function salir() {
    await api.salir().catch(() => {});
    bandeja.correo = null;
  }
</script>

{#if bandeja.menuAbierto}
  <button class="velo" aria-label="Cerrar el menú" onclick={() => (bandeja.menuAbierto = false)}></button>
{/if}

<nav class="carpetas" class:visible={bandeja.menuAbierto} aria-label="Carpetas">
  <div class="marca-cajon">
    <img src="/logo.png" alt="" width="36" height="36" />
    <div><strong>Correo</strong><span>Maderera JBJ</span></div>
  </div>

  <button
    class="redactar"
    onclick={() => {
      bandeja.menuAbierto = false;
      bandeja.redactar("nuevo");
    }}
  >
    <Icono nombre="lapiz" tamano={21} /> Redactar
  </button>

  <div class="panel">
    <ul>
      {#each lista as c (c.ruta)}
        {@const [icono, tono] = estilo[c.rol ?? ""]}
        {@const actual = c.ruta === bandeja.carpeta && !bandeja.ajustesAbiertos}
        {@const n = cuenta(c)}
        <li>
          <button class="fila" class:actual aria-current={actual ? "page" : undefined} onclick={() => bandeja.irACarpeta(c.ruta)}>
            <span class="cuadro" style:--tono="var(--sq{tono})" style:--fondo="oklch(0.66 0.13 {tono} / 0.18)"><Icono nombre={icono} tamano={17} /></span>
            <span class="nombre">{c.nombre}</span>
            {#if n}<span class="contador" aria-label="{n} {c.rol === 'borradores' ? 'borradores' : 'sin leer'}">{n}</span>{/if}
          </button>
        </li>
      {/each}
      {#if !bandeja.carpetas.length}
        {#each Array(6) as _, i (i)}
          <li class="fila fantasma" aria-hidden="true"><span class="cuadro esqueleto"></span><span class="esqueleto" style:width="{50 + ((i * 17) % 40)}%" style:height="12px"></span></li>
        {/each}
      {/if}
    </ul>

    <div class="separador"></div>
    <div class="titulo">Casillas</div>
    <div class="casilla-fila">
      <span class="cuadro lleno">{nombreCasilla.charAt(0).toUpperCase()}</span>
      <span class="datos"><span>{nombreCasilla}</span><small title={casilla}>{corto}</small></span>
    </div>

    <div class="abajo">
      <button class="pie" onclick={onatajos}><Icono nombre="teclado" tamano={18} />Atajos de teclado</button>
      {#if sesion.panel}
        <a class="pie volver-tel" href={sesion.panel}><Icono nombre="panel" tamano={20} />Volver al panel</a>
      {/if}
      <button class="pie salir-tel" onclick={salir}><Icono nombre="salir" tamano={18} />Salir</button>
    </div>
  </div>
</nav>

<style>
  .carpetas {
    width: 272px;
    flex: none;
    display: flex;
    flex-direction: column;
    padding: 4px 14px 16px 16px;
    min-height: 0;
  }
  .marca-cajon {
    display: none;
  }
  .redactar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    height: 58px;
    flex: none;
    border: 0;
    border-radius: 16px;
    background: var(--acc);
    color: #fff;
    font-size: 18px;
    font-weight: 600;
    box-shadow:
      0 2px 0 oklch(0.45 0.17 42),
      0 8px 20px -8px rgb(120 50 10 / 0.55);
  }
  .redactar:hover {
    background: oklch(0.55 0.19 44);
  }
  .redactar:active {
    transform: translateY(1px);
    box-shadow: 0 1px 0 oklch(0.45 0.17 42);
  }
  .panel {
    margin-top: 14px;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 8px;
    border-radius: 16px;
    background: var(--panel);
    box-shadow: var(--panelSh);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    overflow-y: auto;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .fila {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    height: 46px;
    padding: 0 10px 0 8px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    font-size: 16px;
    font-weight: 500;
    color: var(--fg);
    text-align: left;
  }
  .fila:hover {
    background: var(--sel);
  }
  .fila.actual {
    background: var(--itemAct);
    box-shadow: var(--itemSh);
    font-weight: 600;
  }
  .fantasma {
    pointer-events: none;
  }
  .cuadro {
    width: 32px;
    height: 32px;
    flex: none;
    border-radius: 9px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--fondo);
    color: var(--tono);
  }
  .actual .cuadro {
    background: var(--acc);
    color: #fff;
  }
  .actual .contador {
    background: var(--acc);
    color: #fff;
  }
  .nombre {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .separador {
    height: 1px;
    background: var(--ls);
    margin: 10px 8px;
    flex: none;
  }
  .titulo {
    padding: 2px 10px 6px;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--mut);
  }
  .casilla-fila {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 50px;
    padding: 4px 10px 4px 8px;
    border-radius: 10px;
    background: var(--side-act);
  }
  .cuadro.lleno {
    background: var(--avatar);
    color: #fff;
    font-size: 14px;
    font-weight: 700;
  }
  .datos {
    flex: 1;
    min-width: 0;
    display: grid;
    line-height: 1.25;
  }
  .datos span {
    font-size: 16px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .datos small {
    font-size: 13px;
    color: var(--mut);
  }
  .abajo {
    margin-top: auto;
    padding-top: 10px;
    display: grid;
    gap: 2px;
  }
  .pie {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 40px;
    padding: 0 10px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--mut);
    font-size: 14px;
    text-decoration: none;
    text-align: left;
  }
  .pie:hover {
    background: var(--sel);
    color: var(--fg);
  }
  .volver-tel,
  .salir-tel {
    display: none;
  }
  .velo {
    display: none;
  }

  /* Tableta y teléfono: las carpetas van a un cajón que sale del costado. */
  @media (max-width: 1080px) {
    .carpetas {
      position: fixed;
      inset: 0 auto 0 0;
      width: min(316px, 86vw);
      z-index: 30;
      padding: max(16px, env(safe-area-inset-top)) 12px calc(20px + env(safe-area-inset-bottom));
      background-color: var(--card);
      background-image: var(--texC);
      background-size: 160px 160px;
      border-radius: 0 24px 24px 0;
      box-shadow: var(--panelSh);
      transform: translateX(-105%);
      transition: transform 0.2s ease;
      visibility: hidden;
    }
    .carpetas.visible {
      transform: none;
      visibility: visible;
    }
    .marca-cajon {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 12px 16px;
    }
    .marca-cajon img {
      border-radius: 8px;
    }
    .marca-cajon div {
      display: grid;
      line-height: 1.2;
    }
    .marca-cajon strong {
      font-size: 19px;
      font-weight: 600;
    }
    .marca-cajon span {
      font-size: 14px;
      color: var(--mut);
    }
    .panel {
      margin-top: 12px;
      padding: 0;
      background: transparent;
      box-shadow: none;
      backdrop-filter: none;
    }
    .fila {
      height: 48px;
      font-size: 17px;
    }
    .velo {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 29;
      border: 0;
      background: oklch(0.1 0.01 60 / 0.45);
    }
    .volver-tel {
      display: flex;
      height: 48px;
      padding: 0 14px;
      font-size: 17px;
      border-radius: 999px;
      background: var(--mu);
      color: var(--fg);
      margin-top: 6px;
    }
    .salir-tel {
      display: flex;
    }
  }
  @media (max-width: 720px) {
    .redactar {
      display: none;
    }
  }
</style>
