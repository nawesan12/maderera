# Visita al taller: probar el programa y relevar las máquinas

Guía corta para el dueño. No hace falta saber de computadoras: son fotos,
copiar archivos a un pendrive y una prueba. **No se corta nada que no se haya
mirado antes en la pantalla de la máquina.**

Para qué sirve: hoy el operario carga las medidas a mano en WinCut porque
Cutty, el programa que armaba los cortes, no anda. La plataforma ya calcula
cómo cortar cada placa. Queremos saber si la máquina puede leer ese cálculo
desde un pendrive, y si no puede, qué archivo lee.

## Qué llevar

1. **Un pendrive formateado en FAT32.** Windows XP no lee exFAT; uno de 8 o
   16 GB viene casi siempre en FAT32. En la Mac: Utilidad de Discos → Borrar →
   «MS-DOS (FAT)».
2. En una carpeta `MJBJ` del pendrive, **dos archivos**:
   - `PRUEBA1.PTX`. Está en `docs/ptx/PRUEBA1.PTX`, o se baja de cualquier
     corte con el botón **«Programa para la máquina (.PTX) — prueba»** de la
     ficha. Lo mejor es cargar en la plataforma un corte chico de verdad (dos o
     tres piezas) y bajar su archivo.
   - La **hoja de corte en PDF** del mismo trabajo (botón «Hoja para la
     seccionadora» → «Bajar en PDF»), y **una impresa**.
3. El teléfono con batería, para fotos y video.

`PRUEBA1.PTX` es una placa de 2750 × 1830 con sierra de 4,4 mm. De ella salen:
- 2 puertas de 800 × 400 (P1);
- 1 estante de 600 × 350 (P2).

Primero una tira de 400 a lo largo. De esa tira, dos cortes de 800 de través
(las puertas) y uno de 600. De ese trozo de 600, un corte de 350 a lo largo
(el estante).

## La prueba (10 minutos)

1. Enchufar el pendrive en la PC de la seccionadora. **No conectar esa PC a
   internet ni a la red.**
2. En WinCut, buscar en los menús algo como **Archivo → Abrir**, **Importar**,
   **Cargar programa**, **Lista** o **Optimizador**. Si hay un botón de modo
   **automático**, la opción suele estar ahí.
3. Navegar hasta el pendrive (casi siempre `E:` o `F:`) → carpeta `MJBJ` →
   `PRUEBA1.PTX`.
   - Si el cuadro de abrir solo muestra ciertos archivos, **sacar foto del
     filtro de tipos** (la lista desplegable de abajo, tipo «*.001» o «*.xprg»).
     Eso nos dice qué formato espera.
4. Si lo abre: **sacar foto de la pantalla** con el dibujo y compararlo con la
   hoja impresa. Tienen que coincidir las medidas y el orden: 400, después 800
   dos veces y 600, después 350.
   - Si coincide y se quiere probar un corte, que sea **sobre un retazo o una
     placa de descarte**, con el operario mirando, y medir las piezas con el
     metro.
   - Si **no** coincide, no cortar.
5. Si da error o no aparece nada: **foto del mensaje de error**, completo y
   legible, y foto del cuadro de abrir.

## Lo que hay que relevar (fotos y copias)

Para cada máquina (la de WinCut y la otra):

- [ ] **Chapa de la máquina**: la placa metálica con marca, modelo, número de
      serie y año (SCM Sigma, Gabbiani Galaxy, etc.).
- [ ] **Versión de WinCut**: menú **Ayuda → Acerca de** (o «?» → «Info»). Foto.
- [ ] **La carpeta de programas**. Preguntarle al operario dónde guarda WinCut
      los programas, abrirla en el Explorador de Windows, ponerla en **Ver →
      Detalles** y sacar foto donde se vean **los nombres con su extensión**
      (lo que va después del punto: `.001`, `.xprg`, `.ptx`, `.900`, `.lst`…).
      Si no se ven las extensiones: **Herramientas → Opciones de carpeta → Ver**
      y destildar «Ocultar las extensiones de archivo».
- [ ] **Copiar dos o tres programas existentes al pendrive**, de un trabajo
      común: copiar, no mover. Es lo más valioso de la visita. Con un archivo
      real se ajusta el generador para que escriba exactamente lo que la
      máquina lee.
- [ ] **Configuración de la sierra**: en WinCut, la pantalla de parámetros o
      herramientas. Foto del **espesor del disco** que tiene cargado (por
      ejemplo 4,4 o 4,8 mm), y de si descuenta la sierra sola.
- [ ] **Llave USB de licencia**: si hay un pendrive o llave enchufada en la PC
      que no se puede sacar, que diga **Sentinel**, **HASP**, **Rainbow** o
      **Aladdin**, foto. Sin ella el programa no arranca, y Cutty puede no andar
      justamente por eso.
- [ ] **Video corto del operario cargando un corte a mano** en el
      semiautomático: qué pantalla usa, qué tipea, en qué orden. Con eso se
      confirma que la hoja de corte está en el orden en que él trabaja.
- [ ] **Qué programas hay instalados**: foto del menú Inicio → Todos los
      programas. Buscar **Cutty**, **Maestro Pattern**, **Maestro ActiveCut**,
      **Maestro Converter**, **Perfect Cut** u otro optimizador.
- [ ] **Si está Maestro Pattern o Maestro ActiveCut** (en la otra máquina o en
      otra PC): versión (Ayuda → Acerca de), si tiene un menú **Importar**, y
      qué tipos de archivo ofrece ese menú. Foto.
- [ ] **Cutty**: abrirlo y sacar foto del error que da.
- [ ] **Cómo entra la placa**: si el operario la apoya a lo largo, y de qué
      lado hace el primer corte (contra la escuadra o del lado del empujador).
- [ ] **Refilado**: si refila siempre el borde de fábrica, y cuánto.

## Después de la visita

Las fotos, los programas copiados y el video van a la carpeta del proyecto.
Con un programa real:

- si es PTX, se compara campo por campo con el nuestro (`docs/PTX.md`, «Lo que
  no está confirmado») y se ajusta `lib/cortes/ptx.ts`;
- si es otro formato (`.001`, `.900`, `.xprg`…), se arma un generador para ese
  formato desde el mismo plano (`lib/cortes/secuencia.ts`).

Mientras tanto, la **hoja de corte** sirve igual: es la lista que el operario
tipea en el semiautomático. Se abre desde la ficha del corte y desde cada
tarjeta de `/taller`.
