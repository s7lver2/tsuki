import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tsuki",
  description:
    "Your next favourite IDE",
  keywords: ["arduino", "go", "firmware", "transpiler", "IDE", "embedded"],
  openGraph: {
    title: "tsuki — Write Arduino firmware in Go",
    description:
      "A complete toolkit for Arduino development. Transpile Go to C++, compile without arduino-cli, and flash your boards from a beautiful IDE.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}
