import { FeatureCards, Hero } from "../components";

export function Home() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-12 py-12">
      <Hero
        title="酒店中央空调计费系统"
        subtitle="为每个房间提供精准的调度、计费与监控。"
        cta={
          <button className="rounded-xl bg-white/90 px-6 py-3 text-sm font-semibold text-gray-900 shadow-sm transition hover:shadow-lg">
            进入控制台
          </button>
        }
      />
      <FeatureCards />
    </div>
  );
}
