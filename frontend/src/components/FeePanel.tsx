type FeePanelProps = {
  currentFee: number;
  totalFee: number;
};

export function FeePanel({ currentFee, totalFee }: FeePanelProps) {
  return (
    <section className="rounded-2xl bg-brand-primary text-white p-6">
      <p className="text-xs uppercase tracking-[0.4em] text-white/60">费用</p>
      <div className="mt-4 flex flex-wrap items-end gap-6">
        <div>
          <p className="text-4xl font-semibold">
            ¥ {currentFee.toFixed(2)}
          </p>
          <p className="text-sm text-white/70">本次费用</p>
        </div>
        <div>
          <p className="text-2xl font-medium text-white/90">
            ¥ {totalFee.toFixed(2)}
          </p>
          <p className="text-sm text-white/60">累计费用</p>
        </div>
      </div>
    </section>
  );
}
