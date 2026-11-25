<script lang="ts" module>
  import { api, type Conexion } from "../lib/api";

  // Una vez por adjunto y sesión: leer un PDF cuesta bajarlo del IMAP.
  const cache = new Map<string, Promise<Conexion | null>>();
  export function conexionDe(carpeta: string, uid: number, indice: number, de: string): Promise<Conexion | null> {
    const clave = `${carpeta}/${uid}/${indice}`;
    let p = cache.get(clave);
    if (!p) {
      p = api.conectar(carpeta, uid, indice, de).catch(() => null);
      cache.set(clave, p);
    }
    return p;
  }
</script>

<script lang="ts">
  import { bandeja } from "../lib/estado.svelte";
  import Icono, { type NombreIcono } from "./Icono.svelte";

  // Lo que el correo encontró en un adjunto y a qué pantalla del panel va:
  // despiece → cortes o presupuesto, factura → compras, lista → precios,
  // comprobante → el cobro del cliente. El panel carga; el correo lee.
  let { conexion, oscuro = false, nombre = "" }: { conexion: Conexion; oscuro?: boolean; nombre?: string } = $props();

  let verTodas = $state(false);
  const iconos: Record<string, NombreIcono> = { despiece: "cortes", factura: "pdf", lista: "planilla", comprobante: "persona" };

  async function copiar() {
    try {
      await navigator.clipboard.writeText(conexion.copiar ?? "");
      bandeja.avisar("Copiado: pegalo en el panel");
    } catch {
      bandeja.avisar("No se pudo copiar.", undefined, true);
    }
  }
</script>

<div class="conexion" class:oscuro>
  <div class="cabeza">
    <span class="icono-tipo"><Icono nombre={iconos[conexion.tipo] ?? "clip"} tamano={20} /></span>
    <div>
      <strong>{conexion.titulo}</strong>
      {#if nombre}<small>{nombre}</small>{/if}
    </div>
  </div>
  <p>{conexion.detalle}</p>
  {#if conexion.datos.length}
    <dl>
      {#each conexion.datos as [que, valor] (que)}
        <dt>{que}</dt>
        <dd class="mono">{valor}</dd>
      {/each}
    </dl>
  {/if}
  {#if conexion.piezas?.length}
    <table>
      <thead><tr><th>Pieza</th><th>Cant.</th><th>Largo</th><th>Ancho</th></tr></thead>
      <tbody>
        {#each verTodas ? conexion.piezas : conexion.piezas.slice(0, 5) as p, i (i)}
          <tr><td>{p.nombre}{#if p.material}<small> · {p.material}</small>{/if}</td><td class="mono">{p.cantidad}</td><td class="mono">{p.largo}</td><td class="mono">{p.ancho}</td></tr>
        {/each}
      </tbody>
    </table>
    {#if conexion.piezas.length > 5}
      <button class="enlace" onclick={() => (verTodas = !verTodas)}>{verTodas ? "Ver menos" : `Ver las ${conexion.piezas.length}`}</button>
    {/if}
  {/if}
  <div class="botones">
    {#each conexion.acciones as a, i (a.enlace + i)}
      <a class="boton" class:principal={i === 0} href={a.enlace} target="_blank" rel="noopener"><Icono nombre={(a.icono as NombreIcono) ?? "afuera"} tamano={18} />{a.texto}</a>
    {/each}
    {#if conexion.copiar}
      <button class="boton" onclick={copiar}><Icono nombre="respuestas" tamano={18} />Copiar {conexion.tipo === "despiece" ? "piezas" : "datos"}</button>
    {/if}
  </div>
</div>

<style>
  .conexion {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px 18px;
    border-radius: 14px;
    background: var(--cli);
    box-shadow: inset 0 0 0 1px var(--ls);
  }
  .conexion.oscuro {
    background: oklch(0.2 0.01 60);
    box-shadow: 0 0 0 1px oklch(1 0 0 / 0.08);
    color: #fff;
    --mut: oklch(1 0 0 / 0.7);
    --ls: oklch(1 0 0 / 0.12);
    --ln: oklch(1 0 0 / 0.25);
    --fg: #fff;
  }
  .cabeza {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .cabeza div {
    display: grid;
    line-height: 1.3;
  }
  .cabeza strong {
    font-size: 16px;
    font-weight: 600;
  }
  .cabeza small {
    font-size: 13px;
    color: var(--mut);
  }
  .icono-tipo {
    display: inline-grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: var(--marBg);
    color: var(--marT);
    flex: none;
  }
  p {
    margin: 0;
    font-size: 15px;
    color: var(--mut);
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 14px;
    margin: 0;
    font-size: 15px;
  }
  dt {
    color: var(--mut);
  }
  dd {
    margin: 0;
  }
  table {
    border-collapse: collapse;
    font-size: 14px;
    width: 100%;
  }
  th {
    text-align: left;
    font-weight: 600;
    padding: 4px 6px;
    border-bottom: 1px solid var(--ln);
  }
  td {
    padding: 4px 6px;
    border-bottom: 1px solid var(--ls);
  }
  td small {
    color: var(--mut);
  }
  .botones {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .oscuro .boton {
    color: #fff;
    border-color: oklch(1 0 0 / 0.2);
  }
  .oscuro .boton.principal {
    border-color: transparent;
  }
  .enlace {
    align-self: flex-start;
    font-size: 14px;
  }
</style>
