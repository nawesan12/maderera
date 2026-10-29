<script lang="ts">
  import { api, ErrorApi } from "../lib/api";
  import { bandeja } from "../lib/estado.svelte";
  import { sesion } from "../lib/sesion.svelte";

  function ultima(): string {
    try {
      return localStorage.getItem("correo:ultima") ?? "";
    } catch {
      return "";
    }
  }

  let correo = $state(ultima());
  let clave = $state("");
  let enviando = $state(false);
  let errores = $state<Record<string, string>>({});
  let general = $state("");

  async function entrar(e: SubmitEvent) {
    e.preventDefault();
    enviando = true;
    errores = {};
    general = "";
    try {
      const s = await api.entrar(correo, clave);
      try {
        localStorage.setItem("correo:ultima", s.correo);
      } catch {
        // sin almacenamiento: la próxima vez se escribe de nuevo
      }
      sesion.tomar(s);
      bandeja.correo = s.correo;
    } catch (err) {
      if (err instanceof ErrorApi && Object.keys(err.errores).length) errores = err.errores;
      else general = err instanceof Error ? err.message : "No se pudo entrar.";
    } finally {
      enviando = false;
      clave = "";
    }
  }
</script>

<main>
  <form onsubmit={entrar} novalidate>
    <div class="marca">
      <img src="/logo.png" alt="" width="48" height="48" />
      <div>
        <h1>Correo</h1>
        <p>Maderera Juan B. Justo</p>
      </div>
    </div>

    <label>
      <span>Casilla</span>
      <input
        class="campo"
        type="email"
        autocomplete="username"
        placeholder="ventas@mjbj.com.ar"
        bind:value={correo}
        aria-invalid={!!errores.correo}
        required
      />
      {#if errores.correo}<small>{errores.correo}</small>{/if}
    </label>

    <label>
      <span>Clave</span>
      <input
        class="campo"
        type="password"
        autocomplete="current-password"
        bind:value={clave}
        aria-invalid={!!errores.clave}
        required
      />
      {#if errores.clave}<small>{errores.clave}</small>{/if}
    </label>

    {#if general}<p class="error" role="alert">{general}</p>{/if}

    <button class="boton principal" disabled={enviando}>{enviando ? "Entrando…" : "Entrar"}</button>
    <p class="nota">¿Te olvidaste la clave? Pedísela a quien administra el correo de la maderera.</p>
  </form>
</main>

<style>
  main {
    min-height: 100%;
    display: grid;
    place-items: center;
    padding: 24px 16px;
    background-color: var(--side);
    background-image: var(--tex);
    background-size: var(--texS);
  }
  form {
    width: min(100%, 420px);
    display: grid;
    gap: 18px;
    background-color: var(--card);
    background-image: var(--texC);
    background-size: 180px 180px;
    border-radius: 16px;
    padding: 32px 28px;
    box-shadow: var(--panelSh);
  }
  .marca {
    display: flex;
    gap: 14px;
    align-items: center;
    margin-bottom: 6px;
  }
  .marca img {
    border-radius: 10px;
  }
  h1 {
    margin: 0;
    font-size: 24px;
    font-weight: 600;
    line-height: 1.15;
  }
  .marca p {
    margin: 2px 0 0;
    color: var(--mut);
    font-size: 15px;
  }
  label {
    display: grid;
    gap: 6px;
  }
  label span {
    font-size: 15px;
    color: var(--mut);
  }
  small,
  .error {
    color: var(--prT);
    margin: 0;
    font-size: 15px;
  }
  input[aria-invalid="true"] {
    border-color: var(--prT);
  }
  button {
    min-height: 50px;
    border-radius: 12px;
    font-size: 17px;
  }
  .nota {
    margin: 0;
    font-size: 14px;
    color: var(--mut);
    text-align: center;
  }
</style>
