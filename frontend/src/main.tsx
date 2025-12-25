import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, Navigate } from "react-router-dom";
import App from "./App.tsx";
import "./index.css";
import { AuthProvider } from "./contexts/AuthContext.tsx";
import { ProtectedRoute } from "./components/ProtectedRoute.tsx";
import {
  FrontDeskPage,
  MonitorPage,
  ReportPage,
  RoomControlPage,
  LoginPage,
  CustomerPage,
  ReceptionistPage,
  ManagerPage,
  ACAdminPage,
  DebugAdminPage,
} from "./pages";

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      // 首页重定向到登录页
      { index: true, element: <Navigate to="/login" replace /> },
      
      // 登录页
      { path: "login", element: <LoginPage /> },
      
      // 顾客角色路由
      {
        path: "customer",
        element: (
          <ProtectedRoute allowedRoles={["customer"]}>
            <CustomerPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "customer/room/:roomId",
        element: (
          <ProtectedRoute allowedRoles={["customer"]}>
            <RoomControlPage />
          </ProtectedRoute>
        ),
      },
      
      // 前台角色路由
      {
        path: "receptionist",
        element: (
          <ProtectedRoute allowedRoles={["receptionist"]}>
            <ReceptionistPage />
          </ProtectedRoute>
        ),
      },
      
      // 酒店经理角色路由
      {
        path: "manager",
        element: (
          <ProtectedRoute allowedRoles={["manager"]}>
            <ManagerPage />
          </ProtectedRoute>
        ),
      },
      
      // 空调管理员角色路由
      {
        path: "ac-admin",
        element: (
          <ProtectedRoute allowedRoles={["ac-admin"]}>
            <ACAdminPage />
          </ProtectedRoute>
        ),
      },
      
      // 调试管理员角色路由
      {
        path: "debug",
        element: (
          <ProtectedRoute allowedRoles={["debug"]}>
            <DebugAdminPage />
          </ProtectedRoute>
        ),
      },
      
      // 兼容旧路由（供调试使用）
      { path: "room-control", element: <Navigate to="/customer" replace /> },
      { path: "room-control/:roomId", element: <RoomControlPage /> },
      { path: "frontdesk", element: <FrontDeskPage /> },
      { path: "monitor", element: <MonitorPage /> },
      { path: "report", element: <ReportPage /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>
);
