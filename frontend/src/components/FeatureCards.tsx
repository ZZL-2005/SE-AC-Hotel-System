type Feature = {
  title: string;
  description: string;
  href: string;
};

const defaultFeatures: Feature[] = [
  { title: "房间控制", description: "开关机、温度、风速", href: "/room-control/101" },
  { title: "办理入住", description: "创建入住订单", href: "/checkin" },
  { title: "办理退房", description: "合并空调与住宿费用", href: "/checkout" },
  { title: "监控面板", description: "房态实时总览", href: "/monitor" },
  { title: "统计报表", description: "关键指标与导出", href: "/report" },
];

export function FeatureCards({ features = defaultFeatures }: { features?: Feature[] }) {
  return (
    <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
      {features.map((feature) => (
        <a
          key={feature.title}
          href={feature.href}
          className="rounded-2xl border border-white/50 bg-white/80 p-6 shadow-sm backdrop-blur transition-all hover:shadow-lg hover:scale-[1.01]"
        >
          <p className="text-xs uppercase tracking-[0.4em] text-gray-400"># UI 美化（苹果风）</p>
          <h3 className="mt-2 text-2xl font-semibold text-gray-900">{feature.title}</h3>
          <p className="mt-3 text-sm text-gray-600">{feature.description}</p>
        </a>
      ))}
    </section>
  );
}
