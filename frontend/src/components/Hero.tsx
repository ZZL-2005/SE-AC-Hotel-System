import type { ReactNode } from "react";

type HeroProps = {
  title: string;
  subtitle: string;
  cta?: ReactNode;
};

export function Hero({ title, subtitle, cta }: HeroProps) {
  return (
    <section className="rounded-[32px] bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 px-12 py-20 text-white shadow-xl transition hover:shadow-2xl hover:scale-[1.01]">
      <p className="text-xs uppercase tracking-[0.35em] text-white/60"># UI 美化（苹果风） · 中央空调</p>
      <h1 className="mt-6 text-5xl font-semibold leading-tight">{title}</h1>
      <p className="mt-4 max-w-2xl text-lg text-white/80">{subtitle}</p>
      {cta && <div className="mt-8 flex items-center gap-4">{cta}</div>}
    </section>
  );
}
