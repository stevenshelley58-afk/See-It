import type { Metadata } from "next";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "See It",
  description: "Shopify room preview and AI render operations"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
