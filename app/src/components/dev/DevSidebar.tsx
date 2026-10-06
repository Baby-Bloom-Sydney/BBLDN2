'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  Home, Users, Baby, Shield, Settings, LayoutDashboard,
  FileText, Search, MessageSquare, Calendar, ChevronLeft,
  ChevronRight, LogIn, UserPlus, HelpCircle, Mail,
  BarChart3, ClipboardList, Eye, FileCheck, PlusCircle, UserCircle
} from 'lucide-react';

const SECTIONS = [
  {
    title: 'Public',
    color: 'text-emerald-500',
    routes: [
      { path: '/', label: 'Home', icon: Home },
      { path: '/nannies', label: 'Browse (Public)', icon: Search },
      { path: '/nannies/dev-1', label: 'Nanny Profile', icon: UserCircle },
      { path: '/about', label: 'About', icon: HelpCircle },
      { path: '/how-it-works', label: 'How It Works', icon: Eye },
      { path: '/contact', label: 'Contact', icon: Mail },
    ],
  },
  {
    title: 'Auth',
    color: 'text-amber-500',
    routes: [
      { path: '/login', label: 'Login', icon: LogIn },
      { path: '/signup', label: 'Signup (Role Select)', icon: UserPlus },
      { path: '/signup/nanny', label: 'Nanny Signup', icon: UserPlus },
      { path: '/signup/parent', label: 'Parent Signup', icon: UserPlus },
      { path: '/forgot-password', label: 'Forgot Password', icon: Settings },
    ],
  },
  {
    title: 'Nanny',
    color: 'text-violet-500',
    routes: [
      { path: '/nanny', label: 'Hub', icon: LayoutDashboard },
      { path: '/nanny/profile', label: 'Edit Profile', icon: Users },
      { path: '/nanny/verification', label: 'Verification', icon: Shield },
      { path: '/nanny/verify', label: 'ID Verification', icon: FileCheck },
      { path: '/nanny/interviews', label: 'Interviews', icon: MessageSquare },
      { path: '/nanny/babysitting', label: 'Babysitting', icon: Baby },
      { path: '/nanny/settings', label: 'Settings', icon: Settings },
    ],
  },
  {
    title: 'Parent',
    color: 'text-blue-500',
    routes: [
      { path: '/parent', label: 'Hub', icon: LayoutDashboard },
      { path: '/parent', label: 'Create Position', icon: FileText },
      { path: '/parent/request', label: 'Nanny Request', icon: PlusCircle },
      { path: '/parent/browse', label: 'Browse (Parent)', icon: Search },
      { path: '/parent/interviews', label: 'Interviews', icon: MessageSquare },
      { path: '/parent/babysitting', label: 'Babysitting', icon: Calendar },
      { path: '/parent/settings', label: 'Settings', icon: Settings },
    ],
  },
  {
    title: 'Admin',
    color: 'text-red-500',
    routes: [
      { path: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { path: '/admin/verifications', label: 'Verifications', icon: Shield },
      { path: '/admin/users', label: 'Users', icon: Users },
      { path: '/admin/pipeline', label: 'Pipeline', icon: ClipboardList },
      { path: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
      { path: '/admin/settings', label: 'Settings', icon: Settings },
    ],
  },
];

export function DevSidebar() {
  const [open, setOpen] = useState(true);
  const pathname = usePathname();

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed right-0 top-1/2 -translate-y-1/2 z-[9998] bg-gray-900 text-white p-2 rounded-l-md shadow-lg hover:bg-gray-700 transition-colors"
        title="Open dev navigator"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="fixed right-0 top-0 bottom-0 z-[9998] w-56 bg-gray-950 text-gray-300 overflow-y-auto shadow-2xl border-l border-gray-800 flex flex-col">
      <div className="flex items-center justify-between px-3 py-3 border-b border-gray-800">
        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Dev Nav</span>
        <button
          onClick={() => setOpen(false)}
          className="text-gray-500 hover:text-white p-1"
          title="Close"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <nav className="flex-1 py-2">
        {SECTIONS.map((section) => (
          <div key={section.title} className="mb-1">
            <div className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest ${section.color}`}>
              {section.title}
            </div>
            {section.routes.map((route) => {
              const Icon = route.icon;
              const isActive = route.path === '/'
                ? pathname === '/'
                : pathname === route.path || pathname.startsWith(route.path + '/');
              return (
                <Link
                  key={route.path}
                  href={route.path}
                  className={`flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
                    isActive
                      ? 'bg-violet-600/20 text-violet-300 border-r-2 border-violet-500'
                      : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="truncate">{route.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="px-3 py-2 border-t border-gray-800 text-[10px] text-gray-600">
        DEV MODE — All auth bypassed
      </div>
    </div>
  );
}
