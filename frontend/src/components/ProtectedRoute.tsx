import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../contexts/AuthContext";
import type { Role } from "../contexts/AuthContext";

interface ProtectedRouteProps {
  allowedRoles: Role[];
  children: ReactNode;
}

export function ProtectedRoute({ allowedRoles, children }: ProtectedRouteProps) {
  const { role, isAuthenticated } = useAuth();

  // 未登录，重定向到登录页
  if (!isAuthenticated || !role) {
    return <Navigate to="/login" replace />;
  }

  // 角色不匹配，重定向到首页或未授权页面
  if (!allowedRoles.includes(role)) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
