import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "../stores/useAuthStore";
import { BottomNav } from "./BottomNav";
import { Header } from "./Header";

interface AppShellProps {
  title: string;
  children: ReactNode;
  /** When false, the screen renders its own header (e.g. the Facebook-style Community bar). */
  header?: boolean;
}

export function AppShell({ title, children, header = true }: AppShellProps) {
  const user = useAuthStore((state) => state.user);

  if (!user) return <Navigate to="/auth" replace />;

  return (
    <div className="app-frame">
      {header ? <Header title={title} /> : null}
      {children}
      <BottomNav />
    </div>
  );
}
