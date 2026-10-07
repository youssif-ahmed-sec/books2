import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "مكتبة سعود الشافعي | إدارة المكتبة",
  description:
    "إدارة المخزون والمبيعات والعملاء في مكتبة سعود الشافعي",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try{document.documentElement.dataset.theme=localStorage.getItem('books2-theme')==='light'?'light':'dark'}catch(e){document.documentElement.dataset.theme='dark'}` }} />
        <link
          rel="preconnect"
          href="https://fonts.googleapis.com"
        />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Noto+Sans+Arabic:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block"
          rel="stylesheet"
        />
      </head>
      <body className="overflow-x-hidden antialiased">
        {children}
      </body>
    </html>
  );
}
