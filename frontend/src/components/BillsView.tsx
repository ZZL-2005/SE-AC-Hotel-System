type Bill = {
  title: string;
  amount: number;
  description: string;
};

export function BillsView({ bills }: { bills: Bill[] }) {
  return (
    <section className="rounded-2xl border border-slate-200 p-6 shadow-card">
      <h3 className="text-2xl font-semibold">账单汇总</h3>
      <div className="mt-4 space-y-4">
        {bills.map((bill) => (
          <div className="flex items-center justify-between" key={bill.title}>
            <div>
              <p className="text-lg font-medium">{bill.title}</p>
              <p className="text-sm text-slate-500">{bill.description}</p>
            </div>
            <p className="text-xl font-semibold">¥ {bill.amount.toFixed(2)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
