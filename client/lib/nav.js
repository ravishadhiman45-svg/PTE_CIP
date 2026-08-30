// Role-based sidebar navigation config.
import {
  LayoutDashboard,
  Inbox,
  Search,
  Boxes,
  Briefcase,
  ClipboardList,
  GraduationCap,
  KanbanSquare,
  BadgeCheck,
  Users,
  UserCircle,
  UserPlus,
  BarChart3,
  Settings,
  Network,
} from 'lucide-react';

// `roles` = permission roles that may see the item. Empty = everyone.
export const NAV_ITEMS = [
  { label: 'My Profile', href: '/profile', icon: UserCircle, roles: [] },
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: [] },
  { label: 'Inbox', href: '/inbox', icon: Inbox, roles: [], badge: 'inbox' },
  // Open to everyone: the page only ever shows the viewer's own subtree, so a
  // leaf employee sees a chart of one person rather than a permission error.
  { label: 'Org Chart', href: '/org-chart', icon: Network, roles: [] },
  { label: 'Search', href: '/search', icon: Search, roles: [] },
  { label: 'Skills', href: '/skills', icon: Boxes, roles: [] },
  { label: 'Roles / Careers', href: '/roles', icon: Briefcase, roles: [] },
  {
    label: 'Assessments',
    href: '/assessments',
    icon: ClipboardList,
    roles: ['admin', 'manager', 'department_head', 'executive', 'mentor', 'sme'],
  },
  { label: 'Training', href: '/training', icon: GraduationCap, roles: [] },
  { label: 'Learning Module', href: '/learning-module', icon: KanbanSquare, roles: [] },
  { label: 'Certifications', href: '/certifications', icon: BadgeCheck, roles: [] },
  {
    label: 'Mentors & SMEs',
    href: '/mentor',
    icon: Users,
    roles: ['admin', 'mentor', 'sme', 'department_head', 'executive', 'training_coordinator'],
  },
  {
    label: 'Employees',
    href: '/employees',
    icon: UserPlus,
    roles: ['admin', 'executive', 'department_head'],
  },
  {
    label: 'Analytics',
    href: '/roadmap',
    icon: BarChart3,
    roles: ['admin', 'executive', 'department_head', 'training_coordinator'],
  },
  { label: 'Admin', href: '/admin', icon: Settings, roles: ['admin'] },
];

export function visibleNav(roles = []) {
  return NAV_ITEMS.filter((item) => item.roles.length === 0 || item.roles.some((r) => roles.includes(r)));
}

export const ROLE_LABELS = {
  admin: 'System Administrator',
  executive: 'Executive Director',
  department_head: 'Department Head',
  manager: 'Manager',
  mentor: 'Mentor',
  sme: 'SME',
  training_coordinator: 'Training Coordinator',
  employee: 'Employee',
};
