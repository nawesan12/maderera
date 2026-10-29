// La prueba de carga del corte final (docs/go/PLAN.md, «Corte final»):
// 200 personas a la vez contra la API de Go, repartidas como un día de
// trabajo: la mayoría mirando el catálogo, el personal en el panel, y las
// pantallas conectadas al tiempo real (SSE). Cuando la tanda 5 esté, se suma
// el mostrador (ESCENARIO_MOSTRADOR).
//
//   k6 run -e URL=http://127.0.0.1:8080 -e COOKIE='better-auth.session_token=…' bench/corte/carga.k6.js
//
// Corta (falla) si más del 1 % de los pedidos falla o si el p95 pasa de 1 s.
import http from "k6/http";
import { check, sleep } from "k6";

const URL = __ENV.URL || "http://127.0.0.1:8080";
const COOKIE = __ENV.COOKIE || "";
const DURACION = __ENV.DURACION || "60s";
const con = () => ({ headers: COOKIE ? { Cookie: COOKIE } : {} });

export const options = {
  scenarios: {
    catalogo: { executor: "constant-vus", vus: 140, duration: DURACION, exec: "catalogo" },
    panel: { executor: "constant-vus", vus: 40, duration: DURACION, exec: "panel" },
    vivo: { executor: "constant-vus", vus: 20, duration: DURACION, exec: "vivo" },
  },
  thresholds: {
    "http_req_failed{tipo:pedido}": ["rate<0.01"],
    "http_req_duration{tipo:pedido}": ["p(95)<1000"],
  },
  summaryTrendStats: ["avg", "p(50)", "p(95)", "p(99)", "max"],
};

const BUSQUEDAS = ["fenolico", "mdf", "pino", "melamina", "tornillo", "18 mm", "placa", "cola"];

export function catalogo() {
  const r = http.get(`${URL}/api/v1/catalogo/productos?publico=true`, { tags: { tipo: "pedido" } });
  check(r, { "catálogo 200": (x) => x.status === 200 });
  const q = BUSQUEDAS[Math.floor(Math.random() * BUSQUEDAS.length)];
  const b = http.get(`${URL}/api/v1/catalogo/productos?publico=true&busqueda=${encodeURIComponent(q)}`, { tags: { tipo: "pedido" } });
  check(b, { "búsqueda 200": (x) => x.status === 200 });
  sleep(1 + Math.random() * 2);
}

const PANEL = ["admin/stock", "admin/precios", "admin/clientes", "admin/cheques", "admin/proveedores", "admin/cortes", "sesion"];

export function panel() {
  const ruta = PANEL[Math.floor(Math.random() * PANEL.length)];
  const r = http.get(`${URL}/api/v1/${ruta}`, { ...con(), tags: { tipo: "pedido" } });
  check(r, { "panel 200": (x) => x.status === 200 });
  sleep(2 + Math.random() * 3);
}

// Una pantalla conectada al tiempo real: abre el SSE y lo deja abierto 20 s
// (k6 lo lee hasta el timeout). Lo que importa es que no se caiga.
export function vivo() {
  const r = http.get(`${URL}/api/vivo`, { ...con(), timeout: "20s", tags: { tipo: "vivo" } });
  check(r, { "vivo abierto": (x) => x.status === 200 || x.error_code === 1050 });
}
