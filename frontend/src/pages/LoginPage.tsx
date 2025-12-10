import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import type { Role } from "../contexts/AuthContext";

interface RoleCardProps {
  role: Role;
  title: string;
  description: string;
  icon: string;
  color: string;
  path: string;
}

function RoleCard({ role, title, description, icon, color, path }: RoleCardProps) {
  const navigate = useNavigate();
  const { setRole } = useAuth();

  const handleSelect = () => {
    setRole(role);
    navigate(path);
  };

  return (
    <button
      onClick={handleSelect}
      className={`group relative overflow-hidden rounded-2xl ${color} p-8 text-left transition-all hover:scale-[1.02] hover:shadow-2xl active:scale-[0.98]`}
    >
      {/* 背景渐变 */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      
      {/* 图标 */}
      <div className="relative mb-4 text-6xl">{icon}</div>
      
      {/* 标题 */}
      <h3 className="relative mb-2 text-2xl font-semibold text-white">
        {title}
      </h3>
      
      {/* 描述 */}
      <p className="relative text-sm text-white/80">
        {description}
      </p>

      {/* 箭头 */}
      <div className="absolute bottom-8 right-8 text-white/60 transition-transform group-hover:translate-x-1">
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
        </svg>
      </div>
    </button>
  );
}

export function LoginPage() {
  const roles: RoleCardProps[] = [
    {
      role: "customer",
      title: "顾客",
      description: "控制您房间的空调设置",
      icon: "🏨",
      color: "bg-gradient-to-br from-[#0071e3] to-[#0077ed]",
      path: "/customer",
    },
    {
      role: "receptionist",
      title: "前台",
      description: "办理入住、退房及账单业务",
      icon: "🎯",
      color: "bg-gradient-to-br from-[#34c759] to-[#30d158]",
      path: "/receptionist",
    },
    {
      role: "manager",
      title: "酒店经理",
      description: "查看运营报表和数据分析",
      icon: "📊",
      color: "bg-gradient-to-br from-[#af52de] to-[#bf5af2]",
      path: "/manager",
    },
    {
      role: "ac-admin",
      title: "空调管理员",
      description: "监控所有空调运行状态",
      icon: "❄️",
      color: "bg-gradient-to-br from-[#ff9500] to-[#ff9f0a]",
      path: "/ac-admin",
    },
    {
      role: "debug",
      title: "调试管理员",
      description: "系统调试与快捷操作",
      icon: "🛠️",
      color: "bg-gradient-to-br from-[#ff3b30] to-[#ff453a]",
      path: "/debug",
    },
  ];

  return (
    <div className="min-h-screen bg-[#f5f5f7] flex items-center justify-center p-8">
      <div className="max-w-6xl w-full">
        {/* 头部 */}
        <div className="text-center mb-12">
          <div className="inline-block p-4 bg-white rounded-2xl shadow-sm mb-6">
            <svg className="w-16 h-16 text-[#0071e3]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="text-5xl font-semibold tracking-tight text-[#1d1d1f] mb-3">
            酒店空调管理系统
          </h1>
          <p className="text-xl text-[#86868b]">
            请选择您的角色登录
          </p>
        </div>

        {/* 角色卡片网格 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
          {roles.map((role) => (
            <RoleCard key={role.role!} {...role} />
          ))}
        </div>

        {/* 底部提示 */}
        <div className="mt-12 text-center">
          <p className="text-sm text-[#86868b]">
            选择角色后，您将获得相应的操作权限
          </p>
        </div>
      </div>
    </div>
  );
}
