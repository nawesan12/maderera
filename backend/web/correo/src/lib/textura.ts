// La madera del fondo: ruido SVG (feTurbulence) en capas, como en el diseño
// (docs/diseno/correo, funciones `svgC`, `capa` y `madera`). Se arma una vez
// al arrancar y queda en variables CSS: `--tex-claro` y `--tex-oscuro` para
// el fondo, `--grano-*` para el grano fino de las tarjetas. app.css elige
// cuál según el tema.

const url = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

function grano(bf: string, oct: number, rgb: number[], k: number, b: number, w: number, h: number) {
  return url(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'><filter id='g'><feTurbulence type='fractalNoise' baseFrequency='${bf}' numOctaves='${oct}' stitchTiles='stitch'/><feColorMatrix type='matrix' values='0 0 0 0 ${rgb[0]} 0 0 0 0 ${rgb[1]} 0 0 0 0 ${rgb[2]} ${k} 0 0 0 ${b}'/></filter><rect width='100%' height='100%' filter='url(#g)'/></svg>`,
  );
}

function capa(id: string, bf: string, oct: number, seed: number, rgb: number[], k: number, b: number) {
  return `<filter id='${id}' x='0' y='0' width='100%' height='100%'><feTurbulence type='fractalNoise' baseFrequency='${bf}' numOctaves='${oct}' seed='${seed}' stitchTiles='stitch'/><feColorMatrix type='matrix' values='0 0 0 0 ${rgb[0]} 0 0 0 0 ${rgb[1]} 0 0 0 0 ${rgb[2]} ${k} 0 0 0 ${b}'/></filter><rect width='100%' height='100%' filter='url(#${id})'/>`;
}

export function ponerTextura() {
  const madera = url(
    `<svg xmlns='http://www.w3.org/2000/svg' width='1000' height='320'>${capa("a", "0.0016 0.05", 4, 7, [0.52, 0.33, 0.15], 2.6, -1.12)}${capa("b", "0.006 0.32", 3, 2, [0.48, 0.3, 0.13], 1.5, -0.7)}${capa("c", "0.0012 0.018", 2, 11, [1, 0.96, 0.86], 1.6, -0.72)}${capa("d", "0.9", 2, 5, [0.35, 0.22, 0.1], 0.9, -0.38)}</svg>`,
  );
  const oscuro = [
    grano("0.9", 2, [0, 0, 0], 1.2, -0.38, 160, 160),
    grano("0.004 0.12", 4, [0.62, 0.45, 0.28], 1.6, -0.82, 700, 220),
    grano("0.01 0.35", 2, [0, 0, 0], 1.6, -0.6, 700, 220),
  ].join(", ");
  const r = document.documentElement.style;
  r.setProperty("--tex-claro", madera);
  r.setProperty("--tex-oscuro", oscuro);
  r.setProperty("--grano-claro", grano("0.9", 2, [0.3, 0.2, 0.1], 0.5, -0.2, 160, 160));
  r.setProperty("--grano-oscuro", grano("0.9", 2, [1, 0.95, 0.85], 0.35, -0.15, 160, 160));
}
