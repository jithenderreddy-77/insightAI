import type { Metadata, Viewport } from "next"
import { GeistSans } from "geist/font/sans"
import { Toaster } from "@/components/ui/toaster"
import { PWAInstallManager } from "@/components/pwa-install-manager"

import "./globals.css"

export const metadata: Metadata = {
  title: "Insight — Extract Intelligence from PDFs",
  description: "Upload PDFs and extract intelligence with AI. Fast, accurate document Q&A powered by LangChain and Supabase.",
  manifest: "/manifest.json",
  icons: {
    icon: "/icons/icon-192x192.png",
    apple: "/icons/apple-touch-icon.png",
  },
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
  maximumScale: 1,
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
        <link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png" />
        <meta name="theme-color" content="#4f46e5" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className={GeistSans.className}>
        <PWAInstallManager />
        {children}
        <Toaster />
      </body>
    </html>
  )
}