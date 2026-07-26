import type { Metadata, Viewport } from "next"
import { GeistSans } from "geist/font/sans"
import { Toaster } from "@/components/ui/toaster"

import "./globals.css"

export const metadata: Metadata = {
  title: "Insight — Extract Intelligence from PDFs",
  description: "Upload PDFs and extract intelligence with AI. Fast, accurate document Q&A powered by LangChain and Supabase.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Insight AI",
  },
}

export const viewport: Viewport = {
  themeColor: "#4f46e5",
  width: "device-width",
  initialScale: 1,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/title.png" />
        <meta name="theme-color" content="#4f46e5" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body className={GeistSans.className}>
        {children}
        <Toaster />
      </body>
    </html>
  )
}