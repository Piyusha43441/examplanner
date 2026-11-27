import React, { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  BookOpen,
  Building2,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  Grid2x2,
  History,
  LayoutDashboard,
  Layers,
  Lock,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  Users,
  X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/ExamWorkspaceContext';
import { useSubscription } from '../context/SubscriptionContext';
import { logoutUser } from '../firebase/service';
import { BrandLogo } from './BrandLogo';
import { PublicFooter } from './PublicFooter';
import { SubscriptionModal } from './SubscriptionModal';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  requiresSubscription?: boolean;
  allowReadOnlyIfHasExams?: boolean;
}

const BASE_NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/create-exam', label: 'Create Examination', icon: FilePlus2, requiresSubscription: true },
  { to: '/students', label: 'Student Data', icon: Users, requiresSubscription: true },
  { to: '/classrooms', label: 'Classroom Setup', icon: Grid2x2, requiresSubscription: true },
  { to: '/planner', label: 'Seating Planner', icon: Layers, requiresSubscription: true },
  {
    to: '/plans',
    label: 'Generated Plans',
    icon: FileSpreadsheet,
    requiresSubscription: true,
    allowReadOnlyIfHasExams: true
  },
  { to: '/reports', label: 'PDF Reports', icon: FileText, requiresSubscription: true },
  { to: '/history', label: 'Examination History', icon: History },
  { to: '/subscribe', label: 'Subscription', icon: CreditCard },
  { to: '/profile', label: 'Institution Profile', icon: Building2 },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/diagnostics', label: 'Diagnostics', icon: Activity },
  { to: '/guide', label: 'Guide', icon: BookOpen }
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { userProfile, institution, dbReachable } = useAuth();
  const { exams, activeExam, selectExam } = useWorkspace();
  const {
    hasActiveAccess,
    subscriptionStatus,
    remainingDays,
    isAdminEmail,
    unreadNotifications,
    requireActiveSubscription,
    dismissNotification
  } = useSubscription();

  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const navItems: NavItem[] = isAdminEmail
    ? [...BASE_NAV_ITEMS, { to: '/admin', label: 'Admin Panel', icon: ShieldCheck }]
    : BASE_NAV_ITEMS;

  const currentNav = navItems.find((item) => item.to === location.pathname) ?? navItems[0];
  const currentTitle = location.pathname === '/about' ? 'About the Founder' : currentNav.label;

  const handleLogout = async () => {
    await logoutUser();
    navigate('/login');
  };

  const isNavItemLocked = (item: NavItem) => {
    if (!item.requiresSubscription || hasActiveAccess) return false;
    if (item.allowReadOnlyIfHasExams && exams.length > 0) return false;
    return true;
  };

  const handleNavClick = (e: React.MouseEvent, item: NavItem) => {
    if (isNavItemLocked(item)) {
      e.preventDefault();
      setMobileOpen(false);
      requireActiveSubscription(item.label);
      return;
    }
    setMobileOpen(false);
  };

  const handleHeaderNewExam = () => {
    if (!requireActiveSubscription('Create Examination')) return;
    navigate('/create-exam');
  };

  const sidebarContent = (
    <div className="flex flex-col h-full bg-[#0F172A] text-slate-100 select-none">
      {/* Brand Header */}
      <div className="px-5 py-5 border-b border-slate-800/90 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <BrandLogo size={32} variant="light" />
          <div className="min-w-0">
            <div className="font-display font-bold text-sm tracking-tight text-white truncate">
              EXAM PLANNER
            </div>
            <div className="text-[11px] text-slate-400 truncate">
              {institution?.name || 'Examination Suite'}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="lg:hidden p-1.5 text-slate-400 hover:text-white rounded-md"
          aria-label="Close navigation menu"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1" aria-label="Main Navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          const locked = isNavItemLocked(item);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={(e) => handleNavClick(e, item)}
              className={({ isActive }) =>
                `flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : locked
                    ? 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                    : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                }`
              }
            >
              <span className="flex items-center gap-3 min-w-0">
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </span>
              {locked && <Lock className="w-3.5 h-3.5 text-slate-500 shrink-0" />}
            </NavLink>
          );
        })}
      </nav>

      {/* Account Footer + Plan Status + Logout */}
      <div className="p-3 border-t border-slate-800/90 space-y-2">
        <button
          type="button"
          onClick={() => {
            setMobileOpen(false);
            navigate('/subscribe');
          }}
          className="w-full text-left px-3 py-2 rounded-lg bg-slate-900/90 border border-slate-800 hover:border-slate-700 transition-colors"
        >
          <div className="text-[11px] text-slate-400">Plan Status</div>
          <div
            className={`text-xs font-semibold mt-0.5 ${
              subscriptionStatus === 'active'
                ? 'text-emerald-400'
                : subscriptionStatus === 'pending'
                ? 'text-amber-400'
                : 'text-slate-200'
            }`}
          >
            {subscriptionStatus === 'active'
              ? `Active · ${remainingDays}d left`
              : subscriptionStatus === 'pending'
              ? 'Pending Approval'
              : subscriptionStatus === 'expired'
              ? 'Expired — Renew ₹1'
              : subscriptionStatus === 'revoked'
              ? 'Revoked — Subscribe ₹1'
              : 'Free Plan — Unlock ₹1'}
          </div>
        </button>

        <div className="px-3 py-2 rounded-lg bg-slate-900/80 border border-slate-800">
          <div className="text-xs font-medium text-white truncate">
            {userProfile?.fullName || 'Coordinator'}
          </div>
          <div className="text-[11px] text-slate-400 truncate">
            {userProfile?.email}
          </div>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-red-950/60 hover:text-red-200 transition-colors"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          <span>Logout</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-[260px] shrink-0 border-r border-slate-800 no-print">
        <div className="sticky top-0 h-screen">{sidebarContent}</div>
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex no-print">
          <div
            className="fixed inset-0 bg-slate-950/60"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative w-[270px] max-w-[85vw] h-full z-10">{sidebarContent}</aside>
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract: Breadcrumb / Context Left, Active Exam Selector + 1 Primary Action Right */}
        <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4 no-print">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-400 font-medium hidden sm:inline whitespace-nowrap">
                {institution?.name || 'EXAM PLANNER'}
              </span>
              <span className="text-slate-300 hidden sm:inline">/</span>
              <h1 className="font-display font-semibold text-slate-900 truncate">
                {currentTitle}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {exams.length > 0 && (
              <div className="hidden md:flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-slate-400 shrink-0" />
                <select
                  aria-label="Active Examination"
                  value={activeExam?.id || ''}
                  onChange={(e) => {
                    if (e.target.value) selectExam(e.target.value);
                  }}
                  className="text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-slate-800 max-w-[230px] focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {exams.map((ex) => (
                    <option key={ex.id} value={ex.id}>
                      {ex.name} ({ex.studentCount} students)
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="button"
              onClick={handleHeaderNewExam}
              className="px-4 py-2 text-xs sm:text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0"
            >
              New Examination
            </button>
          </div>
        </header>

        {!dbReachable && (
          <div className="bg-amber-50 border-b border-amber-200 px-6 py-2.5 text-xs text-amber-900 no-print">
            Firebase backend connection could not be verified. Check your VITE_FIREBASE_API_KEY and VITE_FIREBASE_PROJECT_ID configuration or network connection before saving records.
          </div>
        )}

        {/* Unread Subscription / Admin Approval Notifications */}
        {unreadNotifications.length > 0 && (
          <div className="border-b border-slate-200 bg-white px-4 sm:px-6 lg:px-8 py-2.5 space-y-2 no-print">
            {unreadNotifications.slice(0, 2).map((n) => {
              const isApproved = n.type === 'payment_approved';
              return (
                <div
                  key={n.id}
                  className={`flex items-start justify-between gap-3 rounded-lg px-3.5 py-2.5 text-xs border ${
                    isApproved
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                      : 'bg-red-50 border-red-200 text-red-950'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {isApproved ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <span className="font-semibold">{n.title}:</span> {n.message}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => dismissNotification(n.id)}
                    className="text-xs font-medium underline shrink-0"
                  >
                    Dismiss
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
        <PublicFooter />
      </div>

      <SubscriptionModal />
    </div>
  );
}
