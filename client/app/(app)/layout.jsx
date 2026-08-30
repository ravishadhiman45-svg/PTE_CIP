'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import { useAuth } from '@/components/AuthProvider';

const TITLES = [
  ['/dashboard', 'PTE CIP — Executive Dashboard'],
  ['/inbox', 'Inbox'],
  ['/search', 'Search'],
  ['/skills', 'Skills Library'],
  ['/roles', 'Roles / Careers'],
  ['/assessments', 'Assessments'],
  ['/training', 'Training Catalog'],
  ['/learning-module', 'Learning Module'],
  ['/certifications', 'Certification Tracker'],
  ['/mentor', 'Mentor Dashboard'],
  ['/roadmap', 'Future Skills Roadmap'],
  ['/employees', 'Employee Profile'],
  ['/profile', 'My Profile'],
  ['/admin', 'Admin Settings'],
];

function titleFor(pathname) {
  const match = TITLES.find(([prefix]) => pathname.startsWith(prefix));
  return match ? match[1] : 'PTE CIP';
}

export default function AppLayout({ children }) {
  const { user, ready } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (ready && !user) router.replace('/login');
  }, [ready, user, router]);

  if (!ready || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-950 text-slate-500">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink-950">
      <Sidebar />
      <div className="pl-16 md:pl-60">
        <Topbar title={titleFor(pathname)} />
        <main className="mx-auto max-w-[1400px] p-5 lg:p-7">{children}</main>
      </div>
    </div>
  );
}
