import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "רשימת מורשים — Content AI",
  icons: {
    icon: "/icon.png",
    apple: "/apple-icon.png",
  },
}

export default function AllowlistLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
