const speeds = [
  { label: "高", value: "HIGH" },
  { label: "中", value: "MID" },
  { label: "低", value: "LOW" },
];

type SpeedSelectorProps = {
  value: string;
  onChange?: (speed: string) => void;
};

export function SpeedSelector({ value, onChange }: SpeedSelectorProps) {
  return (
    <div className="rounded-2xl border border-slate-200 p-6">
      <p className="text-sm uppercase tracking-[0.3em] text-brand-muted">风速</p>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {speeds.map((speed) => (
          <button
            key={speed.value}
            onClick={() => onChange?.(speed.value)}
            className={[
              "rounded-xl border px-4 py-3 font-medium transition-all",
              value === speed.value
                ? "border-brand-accent bg-brand-accent/10 text-brand-accent"
                : "border-slate-200 text-brand-muted hover:border-brand-muted",
            ].join(" ")}
          >
            {speed.label}
          </button>
        ))}
      </div>
    </div>
  );
}
