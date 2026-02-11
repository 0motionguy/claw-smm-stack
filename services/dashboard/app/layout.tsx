import type { Metadata } from 'next';
import Link from 'next/link';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Claw SMM Dashboard',
  description: 'AI Social Media Manager - Admin Dashboard',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="flex h-screen overflow-hidden">
          {/* Sidebar */}
          <aside className="w-64 border-r bg-card">
            <div className="flex h-full flex-col">
              {/* Logo/Brand */}
              <div className="border-b p-6">
                <h1 className="text-2xl font-bold text-primary">Claw SMM</h1>
                <p className="text-sm text-muted-foreground">AI Social Manager</p>
              </div>

              {/* Navigation */}
              <nav className="flex-1 space-y-1 p-4">
                <NavLink href="/" icon="📊">
                  Dashboard
                </NavLink>
                <NavLink href="/tenants" icon="👥">
                  Tenants
                </NavLink>
                <NavLink href="/analytics" icon="📈">
                  Analytics
                </NavLink>
              </nav>

              {/* Footer */}
              <div className="border-t p-4">
                <p className="text-xs text-muted-foreground">
                  v1.0.0 - {new Date().getFullYear()}
                </p>
              </div>
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex-1 overflow-y-auto bg-background">
            <div className="container mx-auto p-8">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}

interface NavLinkProps {
  href: string;
  icon: string;
  children: React.ReactNode;
}

function NavLink({ href, icon, children }: NavLinkProps) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <span className="text-lg">{icon}</span>
      <span>{children}</span>
    </Link>
  );
}
