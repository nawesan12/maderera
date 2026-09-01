"use client";

import { ErrorDePantalla } from "@/components/error-pantalla";

export default function ErrorTaller(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorDePantalla {...props} donde="el taller" />;
}
