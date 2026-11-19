# El comité de revisión

Desde el 18/11/2026, ningún cambio se despliega sin pasar por un comité de
agentes que lo revisan desde ángulos distintos:

- dueño de maderera;
- operario o cajera de 50+;
- contador;
- carpintero o cliente;
- diseñadora de producto;
- seguridad y plata;
- QA adversarial;
- rendimiento y escala.

La vara es la de un estudio de primer nivel: no alcanza con que algo
funcione.

## Cómo se trabaja

1. **Plan corto, revisado por el comité antes de construir.** Corregir el
   rumbo sale más barato que corregir el código.
2. **Construcción.** Las tandas independientes van en carriles paralelos:
   cada una en un git worktree con su propio rango de migraciones y su
   propia plantilla de pruebas (`MJBJ_PRUEBA_PLANTILLA`).
3. **Comité sobre el diff y las capturas.** Revisores de solo lectura, cada
   uno con su personalidad.
4. **Corrección** hasta que no queden hallazgos altos ni medios.
5. **Comité final sobre lo integrado.** No se puede saltear: los defectos
   más caros aparecen donde se cruzan dos tandas, y ninguna los ve por su
   cuenta.

## Los informes

| Fecha | Informe | Qué salió |
|---|---|---|
| 18/11/2026 | [2026-11-18-informe.md](2026-11-18-informe.md) | 48 hallazgos sobre todo el sistema, ordenados en 8 tandas |
| 19/11/2026 | [2026-11-19-informe-final.md](2026-11-19-informe-final.md) | El comité final sobre las 8 tandas integradas: 5 altos y 21 medios, todos arreglados antes de desplegar |

Las 8 tandas y los arreglos del comité final se desplegaron el 19/11/2026
en `main` be0a156. Lo que quedó decidido y lo que falta está en
`docs/go/progreso.md`, sección «19/11/2026: comité final y despliegue».
