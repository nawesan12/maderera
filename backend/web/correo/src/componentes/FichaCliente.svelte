<script lang="ts">
  import type { Ficha } from "../lib/clientes.svelte";
  import { iniciales } from "../lib/formato";
  import Icono from "./Icono.svelte";

  // La ficha del cliente al costado del correo (2a): saldo, pedidos
  // abiertos, el último presupuesto y los botones para seguir en el panel.
  // `compacta` es la tarjeta que va adentro del mensaje en pantallas
  // angostas y en el teléfono.
  let { ficha, compacta = false }: { ficha: Ficha; compacta?: boolean } = $props();

  function pesos(n: number): string {
    const entero = Math.abs(n) % 1 === 0;
    return (
      "$ " +
      Math.abs(n).toLocaleString("es-AR", { minimumFractionDigits: entero ? 0 : 2, maximumFractionDigits: 2 })
    );
  }

  // Los nombres y colores de cada estado de pedido, los mismos del panel
  // (components/admin/etiqueta-estado.tsx).
  const estados: Record<string, [string, string]> = {
    pendiente: ["Pendiente", "mar"],
    preparando: ["Preparando", "esp"],
    listo: ["Listo para retirar", "ok"],
    "en-camino": ["En camino", "inf"],
  };

  const debe = $derived(ficha.saldo > 0.005);
  const aFavor = $derived(ficha.saldo < -0.005);
  const detalleSaldo = $derived.by(() => {
    if (ficha.cuentaBloqueada) return "Cuenta bloqueada";
    if (debe) return ficha.limiteCredito > 0 ? `Debe · tiene límite de ${pesos(ficha.limiteCredito)}` : "Debe";
    if (aFavor) return "Tiene a favor";
    return ficha.limiteCredito > 0 ? `Al día · límite de ${pesos(ficha.limiteCredito)}` : "Al día";
  });
  const pedidos = $derived(ficha.pedidos.length === 1 ? "1 pedido abierto" : `${ficha.pedidos.length} pedidos abiertos`);

  const diaMes = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short" });
  function vence(iso: string): string {
    const d = new Date(iso);
    const dias = Math.round((new Date(d.toDateString()).getTime() - new Date(new Date().toDateString()).getTime()) / 864e5);
    if (dias < 0) return "venció";
    if (dias === 0) return "vence hoy";
    if (dias === 1) return "vence mañana";
    if (dias <= 7) return `vence en ${dias} días`;
    return `vence el ${diaMes.format(d).replace(".", "")}`;
  }
  const estadosPresupuesto: Record<string, string> = {
    pendiente: "Pendiente",
    revision: "En revisión",
    enviado: "Enviado, sin respuesta",
    aceptado: "Aceptado",
    rechazado: "Rechazado",
    vencido: "Vencido",
  };
</script>

{#if compacta}
  <a class="ficha compacta" href={ficha.enlaces.ficha} target="_blank" rel="noopener">
    <span class="texto">
      <strong>{ficha.nombre} · cliente</strong>
      <span>
        {#if debe}Debe <b>{pesos(ficha.saldo)}</b>{:else if aFavor}A favor <b>{pesos(ficha.saldo)}</b>{:else}Al día{/if}
        {#if ficha.pedidos.length} · {pedidos}{/if}
      </span>
    </span>
    <Icono nombre="flecha-derecha" tamano={22} />
  </a>
{:else}
  <aside class="ficha" aria-label="Ficha del cliente">
    <div class="es">Es cliente</div>
    <div class="quien">
      <span class="avatar cliente" style:width="48px" style:height="48px" style:font-size="17px">{iniciales({ nombre: ficha.nombre, correo: "" })}</span>
      <div>
        <strong>{ficha.nombre}</strong>
        {#if ficha.razonSocial && ficha.razonSocial !== ficha.nombre}<span>{ficha.razonSocial}</span>{/if}
        {#if ficha.profesional}<span class="chip inf pro">Profesional</span>{/if}
      </div>
    </div>
    <div class="bloque">
      <span class="rotulo">Saldo de cuenta corriente</span>
      <span class="saldo" class:al-dia={!debe}>{pesos(ficha.saldo)}</span>
      <span class="rotulo">{detalleSaldo}</span>
    </div>
    <div class="bloque pedidos">
      <span class="rotulo">Pedidos abiertos</span>
      {#each ficha.pedidos.slice(0, 5) as p (p.id)}
        {@const [nombre, familia] = estados[p.estado] ?? [p.estado, "ce"]}
        <a class="pedido" href={p.enlace} target="_blank" rel="noopener"><span>Pedido {p.numero.replace(/^PED-/, "")}</span><span class="chip {familia}">{nombre}</span></a>
      {:else}
        <span class="ninguno">Ninguno</span>
      {/each}
      {#if ficha.pedidos.length > 5}<a class="enlace mas" href={ficha.enlaces.pedidos} target="_blank" rel="noopener">y {ficha.pedidos.length - 5} más</a>{/if}
    </div>
    {#if ficha.cheques.length}
      <div class="bloque pedidos">
        <span class="rotulo">Cheques por vencer</span>
        {#each ficha.cheques.slice(0, 3) as c (c.id)}
          <div class="pedido"><span>{pesos(c.importe)}</span><span class="vence" class:ya={new Date(c.fechaPago) < new Date()}>{vence(c.fechaPago)}</span></div>
        {/each}
        {#if ficha.cheques.length > 3}<a class="enlace mas" href={ficha.enlaces.cheques} target="_blank" rel="noopener">y {ficha.cheques.length - 3} más</a>{/if}
      </div>
    {/if}
    {#if ficha.ultimoPresupuesto}
      {@const p = ficha.ultimoPresupuesto}
      <a class="bloque presupuesto" href={p.enlace} target="_blank" rel="noopener">
        <span class="rotulo">Último presupuesto</span>
        <span>{p.numero} · {pesos(p.total)}</span>
        <span class="rotulo" class:espera={p.estado === "enviado"}>{estadosPresupuesto[p.estado] ?? p.estado}</span>
      </a>
    {/if}
    <div class="botones">
      <a class="boton principal" href={ficha.enlaces.presupuesto} target="_blank" rel="noopener"><Icono nombre="presupuesto" tamano={19} />Hacer presupuesto</a>
      <a class="boton" href={ficha.enlaces.pedido} target="_blank" rel="noopener"><Icono nombre="pedido" tamano={19} />Hacer pedido</a>
      <a class="enlace ver" href={ficha.enlaces.ficha} target="_blank" rel="noopener">Ver ficha completa</a>
    </div>
  </aside>
{/if}

<style>
  .ficha:not(.compacta) {
    width: 300px;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 20px;
    border-left: 1px solid var(--ls);
    background: var(--cli);
    overflow-y: auto;
  }
  .es,
  .rotulo {
    font-size: 15px;
    color: var(--mut);
  }
  .es {
    font-size: 14px;
    font-weight: 600;
  }
  .quien {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: -8px;
    line-height: 1.35;
  }
  .quien div {
    display: grid;
    min-width: 0;
  }
  .quien strong {
    font-size: 18px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .quien span {
    font-size: 15px;
    color: var(--mut);
  }
  .bloque {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .saldo {
    font-size: 28px;
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1.3;
    color: var(--accT);
    font-variant-numeric: tabular-nums;
  }
  .saldo.al-dia {
    color: var(--fg);
  }
  .pedidos {
    gap: 10px;
  }
  .pro {
    justify-self: start;
    margin-top: 4px;
    line-height: 22px;
  }
  .vence {
    font-size: 15px;
    color: var(--mut);
  }
  .vence.ya {
    color: var(--prT);
    font-weight: 600;
  }
  .presupuesto {
    color: inherit;
    text-decoration: none;
    border-radius: 8px;
  }
  .presupuesto:hover span:nth-child(2) {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .espera {
    color: var(--espT);
    font-weight: 500;
  }
  a.pedido {
    color: inherit;
    text-decoration: none;
  }
  a.pedido:hover > span:first-child {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .pedido {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 16px;
  }
  .pedido .chip {
    line-height: 26px;
    padding: 0 10px;
  }
  .ninguno {
    font-size: 16px;
  }
  .mas {
    font-size: 15px;
    align-self: flex-start;
  }
  .botones {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 4px;
  }
  .botones .boton {
    height: 48px;
    border-radius: 12px;
  }
  .botones .boton:not(.principal) {
    background: var(--card);
  }
  .ver {
    text-align: center;
    font-size: 15px;
    font-weight: 500;
  }
  .compacta {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border-radius: 14px;
    background: var(--cli);
    box-shadow: inset 0 0 0 1px var(--ls);
    color: var(--mut);
    text-decoration: none;
    min-height: 44px;
  }
  .compacta .texto {
    flex: 1;
    display: grid;
    line-height: 1.35;
  }
  .compacta strong {
    font-size: 16px;
    font-weight: 600;
    color: var(--fg);
  }
  .compacta span span {
    font-size: 15px;
  }
  .compacta b {
    color: var(--accT);
    font-weight: 600;
  }
</style>
