import { startTransition, type FormEvent } from "react";

/**
 * El `onSubmit` de un formulario que no se vacía si la acción contesta un
 * error. Con `<form action>`, React lo resetea después de cada envío: el
 * campo volvía a lo guardado y se perdía lo escrito, justo cuando el error
 * pedía corregirlo (mes simulado, M3S1-011 y los textos del sitio).
 */
export function sinResetear(accion: (datos: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const datos = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => accion(datos));
  };
}
