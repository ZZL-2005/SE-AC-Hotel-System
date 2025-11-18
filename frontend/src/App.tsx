import { NavLink, Outlet } from "react-router-dom";

const navItems = [
  { to: "/", label: "首页" },
  { to: "/room-control", label: "房间控制" },
  { to: "/checkin", label: "办理入住" },
  { to: "/checkout", label: "办理退房" },
  { to: "/monitor", label: "监控面板" },
  { to: "/report", label: "统计报表" },
];

function App() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-slate-50 to-white text-gray-900">
      <header className="sticky top-0 z-10 border-b border-white/70 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="text-xl font-semibold tracking-tight">中央空调计费控制台</span>
          <nav className="flex gap-4 text-sm font-medium">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  [
                    "rounded-full px-4 py-2 transition-all hover:bg-gray-100",
                    isActive ? "bg-gray-900 text-white shadow-sm" : "text-gray-500",
                  ].join(" ")
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-12">
        <Outlet />
      </main>
    </div>
  );
}

export default App;
