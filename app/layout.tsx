import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gavrion CRM",
  description: "CRM multiempresa con conversaciones, ventas e IA."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
