/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

export type Role = "customer" | "receptionist" | "manager" | "ac-admin" | "debug" | null;

interface AuthContextType {
  role: Role;
  setRole: (role: Role) => void;
  logout: () => void;
  isAuthenticated: boolean;
  selectedRoomId: string | null;
  setSelectedRoomId: (roomId: string | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const STORAGE_KEY = "ac_system_role";
const ROOM_STORAGE_KEY = "ac_system_selected_room";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>(() => {
    if (typeof window === "undefined") return null;
    return (window.localStorage.getItem(STORAGE_KEY) as Role) ?? null;
  });
  const [selectedRoomId, setSelectedRoomIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(ROOM_STORAGE_KEY);
  });

  const setRole = (newRole: Role) => {
    setRoleState(newRole);
    if (newRole) {
      localStorage.setItem(STORAGE_KEY, newRole);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  const setSelectedRoomId = (roomId: string | null) => {
    setSelectedRoomIdState(roomId);
    if (roomId) {
      localStorage.setItem(ROOM_STORAGE_KEY, roomId);
    } else {
      localStorage.removeItem(ROOM_STORAGE_KEY);
    }
  };

  const logout = () => {
    setRoleState(null);
    setSelectedRoomIdState(null);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(ROOM_STORAGE_KEY);
  };

  return (
    <AuthContext.Provider
      value={{
        role,
        setRole,
        logout,
        isAuthenticated: role !== null,
        selectedRoomId,
        setSelectedRoomId,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
