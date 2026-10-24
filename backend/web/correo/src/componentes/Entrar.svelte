<script lang="ts">
  import { api, ErrorApi } from "../lib/api";
  import { bandeja } from "../lib/estado.svelte";

  let correo = $state(localStorage.getItem("correo:ultima") ?? "");
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
      localStorage.setItem("correo:ultima", s.correo);
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
      <span class="logo" aria-hidden="true">
        <svg viewBox="0 0 32 32" width="40" height="40"
          ><rect width="32" height="32" rx="8" fill="var(--naranja)" /><path
            d="M7 11l9 6 9-6M7 10h18v12H7z"
            fill="none"
            stroke="#fff"
            stroke-width="2.2"
            stroke-linejoin="round"
          /></svg
        >
      </span>
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
    background:
      radial-gradient(60rem 30rem at 10% -10%, var(--naranja-suave), transparent 60%),
      var(--fondo);
  }
  form {
    width: min(100%, 380px);
    display: grid;
    gap: 18px;
    background: var(--superficie);
    border: 1px solid var(--borde);
    border-radius: 16px;
    padding: 28px 24px;
    box-shadow: var(--sombra);
  }
  .marca {
    display: flex;
    gap: 14px;
    align-items: center;
    margin-bottom: 4px;
  }
  .logo {
    display: grid;
  }
  h1 {
    margin: 0;
    font-size: 1.5rem;
    line-height: 1.1;
  }
  .marca p {
    margin: 2px 0 0;
    color: var(--texto-2);
  }
  label {
    display: grid;
    gap: 6px;
  }
  label span {
    font-weight: 600;
    font-size: 0.92rem;
  }
  small,
  .error {
    color: var(--peligro);
    margin: 0;
  }
  input[aria-invalid="true"] {
    border-color: var(--peligro);
  }
  button {
    justify-content: center;
    padding: 0.7em;
    font-size: 1rem;
  }
  .nota {
    margin: 0;
    font-size: 0.85rem;
    color: var(--texto-3);
    text-align: center;
  }
</style>
