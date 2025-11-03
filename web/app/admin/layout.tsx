'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import RequireAdmin from '@/components/RequireAdmin';
import { Shield, Users, Package, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Admin Layout
 *
 * Wraps all admin pages with:
 * - Admin permission check (RequireAdmin component)
 * - Navigation sidebar for admin sections
 * - Consistent styling
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const navItems = [
    {
      name: 'Installer Versions',
      href: '/admin/installers',
      icon: Package,
      description: 'Manage agent installer versions',
    },
    {
      name: 'User Management',
      href: '/admin/users',
      icon: Users,
      description: 'Manage user roles and permissions',
    },
  ];

  return (
    <RequireAdmin>
      <div className="flex min-h-screen bg-slate-900">
        {/* Sidebar Navigation */}
        <aside className="w-64 bg-slate-800 border-r border-slate-700 flex flex-col">
          {/* Header */}
          <div className="p-6 border-b border-slate-700">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-blue-600 rounded-lg">
                <Shield className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">Admin Panel</h1>
                <p className="text-xs text-slate-400">System Management</p>
              </div>
            </div>

            {/* Back to Dashboard */}
            <Link href="/dashboard">
              <Button
                variant="outline"
                size="sm"
                className="w-full border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-700 hover:text-white cursor-pointer"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Dashboard
              </Button>
            </Link>
          </div>

          {/* Navigation Links */}
          <nav className="flex-1 p-4 space-y-2">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;

              return (
                <Link key={item.href} href={item.href}>
                  <div
                    className={`
                      flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors
                      ${
                        isActive
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                      }
                    `}
                  >
                    <Icon className="h-5 w-5 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-sm">{item.name}</p>
                      <p
                        className={`text-xs mt-0.5 ${
                          isActive ? 'text-blue-100' : 'text-slate-500'
                        }`}
                      >
                        {item.description}
                      </p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </nav>

          {/* Footer */}
          <div className="p-4 border-t border-slate-700">
            <p className="text-xs text-slate-500 text-center">
              Administrator Access
            </p>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </RequireAdmin>
  );
}
