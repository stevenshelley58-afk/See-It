"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Play, Store, LayoutDashboard, FileText, Sliders, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  {
    label: "Control Room",
    href: "/",
    icon: LayoutDashboard,
  },
  {
    label: "Runs",
    href: "/runs",
    icon: Play,
  },
  {
    label: "Shops",
    href: "/shops",
    icon: Store,
  },
  {
    label: "Prompts",
    href: "/prompts",
    icon: FileText,
  },
  {
    label: "Controls",
    href: "/controls",
    icon: Sliders,
  },
  {
    label: "Settings",
    href: "/settings",
    icon: Settings,
  },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="w-64 bg-gray-900 text-white flex flex-col">
      {/* Logo */}
      <div className="h-14 flex items-center px-4 border-b border-gray-800">
        <Activity className="h-6 w-6 text-primary-400 mr-2" />
        <span className="font-semibold text-lg">See It Monitor</span>
      </div>

      {/* Navigation items */}
      <div className="flex-1 py-4">
        <ul className="space-y-1 px-2">
          {navItems.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            const Icon = item.icon;

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                    isActive
                      ? "bg-gray-800 text-white"
                      : "text-gray-400 hover:text-white hover:bg-gray-800"
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-gray-800 text-xs text-gray-500">
        See It Monitor v0.1.0
      </div>
    </nav>
  );
}
