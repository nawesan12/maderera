import type { StockLevel } from "@/lib/products";

const config: Record<StockLevel, { color: string; label: string }> = {
  alto: { color: "bg-brand-green", label: "En stock" },
  medio: { color: "bg-yellow-500", label: "Stock limitado" },
  bajo: { color: "bg-brand-red", label: "Poco stock" },
  "sin-stock": { color: "bg-gray-300", label: "Sin stock" },
};

export function StockIndicator({
  level,
  label,
}: {
  level: StockLevel;
  label: string;
}) {
  const { color, label: statusLabel } = config[level];

  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-2 h-2 rounded-full ${color}`} />
      <span className="text-[10px] text-muted-foreground">
        {label}: <span className="font-medium">{statusLabel}</span>
      </span>
    </div>
  );
}
