import { NavLink, Outlet, useLocation } from "react-router-dom";

const navItems = [
  { to: "/", label: "首页" },
  { to: "/room-control", label: "房间控制" },
  { to: "/frontdesk", label: "前台服务" },
  { to: "/monitor", label: "监控面板" },
  { to: "/report", label: "统计报表" },
];

function App() {
  const location = useLocation();
  const isMonitorPage = location.pathname === "/monitor";

  return (
    <div className={`min-h-screen ${isMonitorPage ? "bg-[#f5f5f7]" : "bg-[#fbfbfd]"}`}>
      {/* 导航栏 */}
      <header className="sticky top-0 z-50 glass border-b border-black/[0.04]">
        <div className="mx-auto flex h-12 max-w-[1200px] items-center justify-between px-6">
          {/* Logo */}
          <NavLink to="/" className="flex items-center gap-2.5 group">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#1d1d1f] transition-transform group-hover:scale-105">
              <span className="text-xs text-white">❄️</span>
            </div>
            <span className="text-sm font-semibold tracking-tight text-[#1d1d1f]">AC System</span>
          </NavLink>

          {/* 导航链接 */}
          <nav className="flex items-center gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  [
                    "px-4 py-1.5 text-xs font-medium transition-all duration-200 rounded-full",
                    isActive 
                      ? "bg-[#1d1d1f] text-white" 
                      : "text-[#1d1d1f]/60 hover:text-[#1d1d1f] hover:bg-black/[0.04]",
                  ].join(" ")
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      {/* 主内容区 */}
      <main className={
        isMonitorPage 
          ? "w-full" 
          : "mx-auto w-full max-w-[1200px] px-6 py-16"
      }>
        <Outlet />
      </main>

      {/* 页脚 - 监控页面不显示 */}
      {!isMonitorPage && (
        <footer className="border-t border-black/[0.04] py-8">
          <div className="mx-auto max-w-[1200px] px-6">
            <p className="text-center text-xs text-[#86868b]">
              Software Engineering · Central AC Billing System · 2025
            </p>
          </div>
        </footer>
      )}
    </div>
  );
}

export default App;
