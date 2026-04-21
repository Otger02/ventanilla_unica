import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Gestión Empresarial IA | La República",
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
