type TempGaugeProps = {
  current: number;
  target: number;
};

export function TempGauge({ current, target }: TempGaugeProps) {
  return (
    <div className="rounded-2xl bg-surface-card p-8 shadow-card">
      <p className="text-sm uppercase tracking-[0.3em] text-brand-muted">温度</p>
      <div className="mt-6 flex items-end gap-6">
        <div>
          <span className="text-5xl font-semibold">{current.toFixed(1)} ℃</span>
          <p className="text-sm text-slate-500">当前</p>
        </div>
        <div>
          <span className="text-3xl font-medium text-brand-muted">{target.toFixed(1)} ℃</span>
          <p className="text-sm text-slate-500">目标</p>
        </div>
      </div>
      <div className="mt-6 h-2 rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-brand-accent transition-all"
          style={{ width: `${Math.min((current / target) * 100, 100)}%` }}
        />
      </div>
    </div>
  );
}
