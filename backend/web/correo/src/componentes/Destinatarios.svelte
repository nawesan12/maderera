<script lang="ts">
  import { api, type Direccion } from "../lib/api";
  import { bandeja } from "../lib/estado.svelte";
  import { clientes } from "../lib/clientes.svelte";
  import { sesion } from "../lib/sesion.svelte";
  import { pareceCorreo, separar } from "../lib/borrador";
  import { iniciales, nombreDe } from "../lib/formato";
  import Icono from "./Icono.svelte";

  // Para, Cc y Cco como fichitas (2b). Al escribir sugiere: primero los
  // clientes del ERP (si la casilla los puede ver), después la gente con la
  // que ya hubo correos en esta carpeta.
  let {
    lista = $bindable(),
    id,
    placeholder = "",
    invalido = false,
    enfocar = false,
  }: { lista: Direccion[]; id: string; placeholder?: string; invalido?: boolean; enfocar?: boolean } = $props();

  let texto = $state("");
  let sugeridos = $state<(Direccion & { tipo: string })[]>([]);
  let elegido = $state(0);
  let campo: HTMLInputElement;
  let pedido = 0;
  let espera: ReturnType<typeof setTimeout>;

  $effect(() => {
    if (enfocar) campo?.focus();
  });

  function conocidos(q: string): (Direccion & { tipo: string })[] {
    const vistos = new Map<string, Direccion>();
    for (const m of bandeja.mensajes) for (const d of [...m.de, ...m.para]) if (!vistos.has(d.correo)) vistos.set(d.correo, d);
    const yo = (bandeja.correo ?? "").toLowerCase();
    const n = q.toLowerCase();
    return [...vistos.values()]
      .filter((d) => d.correo !== yo && (d.correo.includes(n) || nombreDe(d).toLowerCase().includes(n)))
      .slice(0, 5)
      .map((d) => ({ ...d, tipo: { cliente: "Cliente", proveedor: "Proveedor", "": "Contacto" }[clientes.tipo(d.correo)] }));
  }

  function buscar() {
    const q = texto.trim();
    if (q.length < 2) return void (sugeridos = []);
    const locales = conocidos(q);
    sugeridos = locales;
    elegido = 0;
    if (!sesion.fichas) return;
    const n = ++pedido;
    clearTimeout(espera);
    espera = setTimeout(async () => {
      try {
        const deErp = await api.contactos(q);
        if (n !== pedido) return;
        const yaEsta = new Set(deErp.map((d) => d.correo));
        sugeridos = [...deErp.map((d) => ({ ...d, tipo: "Cliente" })), ...locales.filter((d) => !yaEsta.has(d.correo))].slice(0, 6);
      } catch {
        // sin ERP: quedan los conocidos
      }
    }, 180);
  }

  function agregar(d: Direccion) {
    if (!lista.some((x) => x.correo === d.correo)) lista = [...lista, d];
    texto = "";
    sugeridos = [];
  }

  /** Pasa a fichita lo que esté escrito, si parece una dirección. */
  export function confirmar() {
    const t = texto.trim();
    if (!t) return;
    const ds = separar(t).filter((d) => pareceCorreo(d.correo));
    if (ds.length) {
      for (const d of ds) agregar(d);
    }
  }

  /** Lo escrito que todavía no es fichita (para no perderlo al mandar). */
  export function pendiente(): string {
    return texto.trim();
  }

  function tecla(e: KeyboardEvent) {
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && sugeridos.length) {
      e.preventDefault();
      elegido = (elegido + (e.key === "ArrowDown" ? 1 : -1) + sugeridos.length) % sugeridos.length;
    } else if (e.key === "Enter" || e.key === "," || e.key === ";" || e.key === "Tab") {
      if (sugeridos.length && texto.trim() && e.key !== ",") {
        e.preventDefault();
        agregar(sugeridos[elegido]);
      } else if (texto.trim()) {
        if (e.key !== "Tab") e.preventDefault();
        confirmar();
      }
    } else if (e.key === "Backspace" && !texto && lista.length) {
      lista = lista.slice(0, -1);
    } else if (e.key === "Escape" && sugeridos.length) {
      e.stopPropagation();
      sugeridos = [];
    }
  }
</script>

<div class="destinatarios" class:invalido>
  {#each lista as d (d.correo)}
    <span class="ficha-dir" title={d.correo}>
      <span class="avatar {clientes.tipo(d.correo)}" style:width="26px" style:height="26px" style:font-size="12px">{iniciales(d)}</span>
      {nombreDe(d)}
      <button type="button" aria-label="Sacar a {nombreDe(d)}" onclick={() => (lista = lista.filter((x) => x.correo !== d.correo))}><Icono nombre="cerrar" tamano={15} /></button>
    </span>
  {/each}
  <input
    {id}
    bind:this={campo}
    bind:value={texto}
    oninput={buscar}
    onkeydown={tecla}
    onblur={() => setTimeout(() => ((sugeridos = []), confirmar()), 150)}
    onpaste={() => setTimeout(confirmar)}
    placeholder={lista.length ? "" : placeholder}
    autocomplete="off"
    aria-invalid={invalido}
    aria-autocomplete="list"
  />
  {#if sugeridos.length}
    <ul class="sugeridos menu-flotante" role="listbox">
      {#each sugeridos as s, i (s.correo)}
        <li role="option" aria-selected={i === elegido}>
          <button type="button" class:elegido={i === elegido} onmousedown={(e) => (e.preventDefault(), agregar(s))} onmouseenter={() => (elegido = i)}>
            <span class="avatar {s.tipo === 'Cliente' ? 'cliente' : s.tipo === 'Proveedor' ? 'proveedor' : ''}" style:width="38px" style:height="38px" style:font-size="15px">{iniciales(s)}</span>
            <span class="datos"><strong>{nombreDe(s)}</strong><small>{s.correo}</small></span>
            <span class="tipo">{s.tipo}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .destinatarios {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
    padding: 9px 0;
  }
  .ficha-dir {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    max-width: 100%;
    padding: 0 4px 0 4px;
    border-radius: 999px;
    background: var(--mu);
    font-size: 16px;
  }
  .ficha-dir button {
    display: inline-grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--mut);
    padding: 0;
  }
  .ficha-dir button:hover {
    background: var(--ls);
    color: var(--fg);
  }
  input {
    flex: 1;
    min-width: 80px;
    height: 34px;
    border: 0;
    background: transparent;
    outline: none;
    font-size: 16px;
  }
  .invalido input {
    color: var(--prT);
  }
  .sugeridos {
    position: absolute;
    top: calc(100% - 2px);
    left: 0;
    width: min(440px, 100%);
    list-style: none;
    margin: 0;
    z-index: 30;
  }
  .sugeridos button {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 10px 16px;
    border: 0;
    background: transparent;
    text-align: left;
  }
  .sugeridos button.elegido {
    background: var(--sel);
  }
  .datos {
    flex: 1;
    min-width: 0;
    display: grid;
    line-height: 1.35;
  }
  .datos strong {
    font-size: 16px;
    font-weight: 500;
  }
  .datos small {
    font-size: 14px;
    color: var(--mut);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tipo {
    font-size: 14px;
    color: var(--mut);
  }
</style>
