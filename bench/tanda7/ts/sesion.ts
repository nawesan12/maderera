// La sesión sin Next: requireStaff devuelve el admin de la base del benchmark.
const usuario = { userId: process.env.BENCH_USUARIO ?? "", name: "Bench", role: "staff", staffRole: "admin" };
export async function requireStaff() {
  return usuario;
}
