import type { Metadata } from "next";
import Link from "next/link";
import { appName } from "@/lib/config";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return {
    title: { default: appName(), template: `%s · ${appName()}` },
    description: "Unified developer contribution leaderboard for GitHub and Bitbucket.",
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const name = appName();
  return (
    <html lang="en">
      <body>
        <header className="top">
          <div className="wrap">
            <Link href="/" className="brand">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M2 12h4l3-8 5 16 3-8h5" />
              </svg>
              {name}
            </Link>
            <Nav />
          </div>
        </header>
        <main>
          <div className="wrap">{children}</div>
        </main>
        <footer>
          <div className="wrap">{name} · contribution scores weigh commits, pull requests, reviews and comments</div>
        </footer>
      </body>
    </html>
  );
}
