import { useState } from "react";
import { frontdeskClient, type CheckOutResponse } from "../api/frontdeskClient";

export function CheckOutPage() {
  const [roomId, setRoomId] = useState("101");
  const [summary, setSummary] = useState<CheckOutResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCheckout = async () => {
    const { data, error } = await frontdeskClient.checkOut(roomId);
    if (error) {
      setError(error);
      return;
    }
    setError(null);
    setSummary(data ?? null);
  };

  return (
    <section className="space-y-6">
      <header>
        <h2 className="text-4xl font-semibold">办理退房流程</h2>
        <p className="text-sm text-slate-500">生成住宿与空调账单及明细记录。</p>
      </header>
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 p-6 md:flex-row md:items-end">
        <label className="flex flex-col text-sm">
          房间号
          <input
            className="rounded-xl border border-slate-200 px-3 py-2"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
          />
        </label>
        <button className="rounded-full bg-brand-accent px-6 py-3 text-sm font-semibold text-white" onClick={handleCheckout}>
          生成账单
        </button>
      </div>
      {error && <div className="rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
      {summary && (
        <div className="space-y-4 rounded-2xl border border-slate-200 p-6 text-sm">
          <h3 className="text-xl font-semibold">账单汇总</h3>
          <div>
            <p className="font-semibold">住宿费用</p>
            <p>账单号：{summary.accommodationBill.billId}</p>
            <p>
              入住晚数：{summary.accommodationBill.nights} × 每晚单价 {summary.accommodationBill.ratePerNight} = ¥
              {summary.accommodationBill.roomFee.toFixed(2)}
            </p>
            <p>押金：¥{summary.accommodationBill.deposit.toFixed(2)}</p>
          </div>
          {summary.acBill && (
            <div>
              <p className="font-semibold">空调费用</p>
              <p>账单号：{summary.acBill.billId}</p>
              <p>
                时段：{summary.acBill.periodStart} → {summary.acBill.periodEnd}
              </p>
              <p>空调费用合计：¥{summary.acBill.totalFee.toFixed(2)}</p>
            </div>
          )}
          <div>
            <p className="font-semibold">明细记录</p>
            <ul className="space-y-2">
              {summary.detailRecords.map((record) => (
                <li key={record.recordId} className="rounded border border-slate-100 p-2">
                  <p>
                    {record.speed} · {record.startedAt} → {record.endedAt ?? "-"}
                  </p>
                  <p>费用：¥{record.feeValue.toFixed(2)}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="font-semibold text-lg">应付合计：¥{summary.totalDue.toFixed(2)}</div>
        </div>
      )}
    </section>
  );
}
