import type { ReactNode } from "react";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body style={{ fontFamily: "sans-serif", margin: 24 }}>{children}</body>
    </html>
  );
}
