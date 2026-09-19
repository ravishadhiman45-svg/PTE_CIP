'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Users,
  ShieldCheck,
  Boxes,
  ClipboardList,
  GraduationCap,
  Award,
  Bell,
  ArrowLeftRight,
  FileClock,
  Settings,
} from 'lucide-react';
import { fetcher } from '@/lib/api';
import { PageHeader, Card, Skeleton, ErrorState, Badge } from '@/components/ui';
import { formatDate } from '@/lib/ui';
import Link from 'next/link';

const TABS = ['Users', 'Roles & Permissions', 'Skill Taxonomy', 'Learning', 'Workflows', 'Integrations', 'Audit Logs'];

const SETTING_CARDS = [
  { icon: Users, title: 'User Management', desc: 'Add, edit and manage platform users' },
  { icon: ShieldCheck, title: 'Role & Permissions', desc: 'Configure roles and access rights' },
  { icon: Boxes, title: 'Skill Taxonomy', desc: 'Manage skills, categories and labels' },
  { icon: ClipboardList, title: 'Assessment Templates', desc: 'Create and manage assessment forms' },
  { icon: GraduationCap, title: 'Training Categories', desc: 'Manage training types and delivery modes' },
  { icon: Award, title: 'Certification Rules', desc: 'Configure approval and renewal rules' },
  { icon: Bell, title: 'Notification Rules', desc: 'Set up automated notifications' },
  { icon: ArrowLeftRight, title: 'Import / Export', desc: 'Bulk import or export platform data' },
  { icon: FileClock, title: 'Audit Logs', desc: 'Track platform activities and changes' },
  { icon: Settings, title: 'System Settings', desc: 'Overall platform configuration' },
];

export default function AdminPage() {
  const [tab, setTab] = useState('Users');

  return (
    <div>
      <PageHeader title="Admin Settings" subtitle="Platform administration and governance" />

      <div className="mb-5 flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-t-lg px-3 py-2 text-sm transition ${
              tab === t ? 'border-b-2 border-accent-soft text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Users' ? <UsersTab /> : null}
      {tab === 'Audit Logs' ? <AuditLogsTab /> : null}
      {tab === 'Roles & Permissions' ? <RolesTab /> : null}
      {tab === 'Learning' ? <LearningTab /> : null}
      {['Skill Taxonomy', 'Workflows', 'Integrations'].includes(tab) ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SETTING_CARDS.map((c) => {
            const Icon = c.icon;
            return (
              <Card key={c.title} className="transition hover:border-accent-soft">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-ink-900 text-accent-soft">
                  <Icon size={18} />
                </div>
                <p className="text-sm font-medium text-white">{c.title}</p>
                <p className="mt-1 text-xs text-slate-500">{c.desc}</p>
              </Card>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function UsersTab() {
  const { data, error, isLoading } = useSWR('/admin/users', fetcher);
  if (error) return <ErrorState error={error} />;
  if (isLoading || !data) return <Skeleton className="h-64" />;
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[820px]">
        <thead className="border-b border-line">
          <tr>
            <th className="th">User</th>
            <th className="th">Department</th>
            <th className="th">Job Role</th>
            <th className="th">Permission Roles</th>
            <th className="th">Last Login</th>
            <th className="th">Active</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {data.map((u) => (
            <tr key={u.id} className="hover:bg-ink-700/40">
              <td className="td">
                <p className="text-white">{u.display_name}</p>
                <p className="text-xs text-slate-500">{u.email}</p>
              </td>
              <td className="td text-slate-400">{u.department || '—'}</td>
              <td className="td text-slate-400">{u.job_role || '—'}</td>
              <td className="td">
                <div className="flex flex-wrap gap-1">
                  {(u.permission_roles || []).map((r) => (
                    <span key={r} className="chip bg-accent/15 text-accent-soft">
                      {r}
                    </span>
                  ))}
                </div>
              </td>
              <td className="td text-slate-400">{formatDate(u.last_login_at)}</td>
              <td className="td">
                <Badge className={u.is_active ? 'bg-good/15 text-good' : 'bg-slate-500/15 text-slate-300'}>
                  {u.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function AuditLogsTab() {
  const { data, error, isLoading } = useSWR('/admin/audit-logs', fetcher);
  if (error) return <ErrorState error={error} />;
  if (isLoading || !data) return <Skeleton className="h-64" />;
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full">
        <thead className="border-b border-line">
          <tr>
            <th className="th">Actor</th>
            <th className="th">Action</th>
            <th className="th">Entity</th>
            <th className="th">When</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {data.map((l) => (
            <tr key={l.id} className="hover:bg-ink-700/40">
              <td className="td text-white">{l.actor || 'System'}</td>
              <td className="td">{l.action}</td>
              <td className="td text-slate-400">{l.entity_type}</td>
              <td className="td text-slate-400">{formatDate(l.created_at)}</td>
            </tr>
          ))}
          {data.length === 0 ? (
            <tr><td className="td text-slate-500" colSpan={4}>No audit records.</td></tr>
          ) : null}
        </tbody>
      </table>
    </Card>
  );
}

function RolesTab() {
  const { data, error, isLoading } = useSWR('/admin/permission-roles', fetcher);
  if (error) return <ErrorState error={error} />;
  if (isLoading || !data) return <Skeleton className="h-64" />;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {data.map((r) => (
        <Card key={r.id}>
          <div className="flex items-center justify-between">
            <p className="font-medium text-white">{r.role_name}</p>
            <span className="chip bg-accent/15 text-accent-soft">{r.user_count} users</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">{r.description}</p>
          <p className="mt-2 text-[11px] text-slate-600">key: {r.role_key}</p>
        </Card>
      ))}
    </div>
  );
}

function LearningTab() {
  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-white">Learning Course Management</h3>
          <p className="mt-1 text-sm text-slate-400">
            Create and manage courses with dynamic content that automatically appear in the Learning Module
          </p>
        </div>
        <Link href="/admin/learning">
          <button className="btn-primary shrink-0">
            <GraduationCap size={16} />
            Manage Courses
          </button>
        </Link>
      </div>
    </Card>
  );
}
