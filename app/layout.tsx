import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RestroPulse — Replicate Image Generator",
  description: "Run any Replicate image model from a prompt/context.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
