import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowUpRight,
  Award,
  Bot,
  Briefcase,
  Code2,
  Compass,
  Cpu,
  Globe,
  GraduationCap,
  Layers,
  Linkedin,
  Mail,
  Phone,
  Terminal,
  Users
} from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo';
import { PublicFooter } from '../components/PublicFooter';

interface HighlightItem {
  title: string;
  category: string;
  icon: React.ComponentType<{ className?: string }>;
}

const PROFESSIONAL_HIGHLIGHTS: HighlightItem[] = [
  {
    title: 'AI Super 20 Alumni – AIMLVerse',
    category: 'AI Community & Cohort',
    icon: Award
  },
  {
    title: "Member – S&P Global's 451 Alliance",
    category: 'Industry Research Network',
    icon: Users
  },
  {
    title: 'Web Development Internship – InAmigos Foundation',
    category: 'Applied Web Engineering',
    icon: Briefcase
  },
  {
    title: 'Agentic AI Systems & Architecture – Scaler',
    category: 'Agentic Systems',
    icon: Bot
  },
  {
    title: 'Microsoft AI for All',
    category: 'AI Foundations',
    icon: Cpu
  },
  {
    title: 'Intel AI Learning Program',
    category: 'AI Learning Program',
    icon: Layers
  },
  {
    title: 'Claude 101',
    category: 'Modern AI Workflows',
    icon: Terminal
  },
  {
    title: 'Generative AI & Prompt Engineering Specializations',
    category: 'Generative AI',
    icon: Code2
  },
  {
    title: 'Additional AI and technology certifications',
    category: 'Continuous Learning',
    icon: GraduationCap
  }
];

export function AboutFounderPage({ isPublicView = false }: { isPublicView?: boolean }) {
  const navigate = useNavigate();

  const pageBody = (
    <div className="space-y-8">
      {/* Top Navigation Context */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => navigate(isPublicView ? '/login' : '/')}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{isPublicView ? 'Back to Sign In' : 'Back to Dashboard'}</span>
        </button>

        {isPublicView && (
          <Link
            to="/login"
            className="inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            <span>Sign In / Register Institution</span>
          </Link>
        )}
      </div>

      {/* Founder Profile & Introduction Hero */}
      <section className="relative overflow-hidden bg-white border border-slate-200 rounded-2xl p-6 sm:p-10">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-slate-50 via-blue-50/30 to-transparent"
        />

        <div className="relative grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Dedicated Founder Profile Area (Initials Avatar "SA" when no photo is provided) */}
          <div className="lg:col-span-4 flex flex-col items-center lg:items-start text-center lg:text-left space-y-5">
            <div className="relative w-36 h-36 sm:w-40 sm:h-40 rounded-2xl bg-gradient-to-br from-[#0F172A] via-slate-800 to-blue-950 border border-slate-700/80 shadow-sm flex items-center justify-center select-none">
              <span className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-white">
                SA
              </span>
            </div>

            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-blue-600 uppercase tracking-wider">
                About the Founder
              </div>
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
                Shyam Agarwal
              </h1>
              <p className="text-sm font-medium text-slate-600 leading-snug">
                AI Developer | Web Builder | Founder of Exam Planner
              </p>
            </div>

            {/* Connect Links */}
            <div className="w-full pt-2 flex flex-col sm:flex-row lg:flex-col gap-2.5">
              <a
                href="https://www.linkedin.com/in/shyam-agarwal-ai/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-between gap-2 px-4 py-2.5 text-sm font-medium text-white bg-[#0F172A] hover:bg-slate-800 rounded-lg transition-colors"
              >
                <span className="inline-flex items-center gap-2">
                  <Linkedin className="w-4 h-4 text-blue-400 shrink-0" />
                  <span>Connect on LinkedIn</span>
                </span>
                <ArrowUpRight className="w-4 h-4 text-slate-400 shrink-0" />
              </a>

              <a
                href="https://shyamagarwal.edgeone.app"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-between gap-2 px-4 py-2.5 text-sm font-medium text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
              >
                <span className="inline-flex items-center gap-2">
                  <Globe className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>View Portfolio</span>
                </span>
                <ArrowUpRight className="w-4 h-4 text-slate-400 shrink-0" />
              </a>
            </div>
          </div>

          {/* Exact Professional Introduction */}
          <div className="lg:col-span-8 lg:border-l lg:border-slate-200 lg:pl-8 space-y-5">
            <div className="space-y-1">
              <h2 className="font-display text-lg sm:text-xl font-bold text-slate-900">
                Founder Introduction
              </h2>
              <div className="h-0.5 w-12 bg-blue-600 rounded-full" />
            </div>

            <div className="space-y-4 text-sm sm:text-base text-slate-700 leading-relaxed">
              <p>
                I'm Shyam Agarwal, an AI Developer and Web Builder passionate about creating practical technology solutions that solve real-world challenges.
              </p>
              <p>
                My work focuses on building AI-driven applications, modern web experiences, and intelligent workflows that make everyday processes simpler and more efficient.
              </p>
              <p>
                My journey includes being an AI Super 20 Alumni (AIMLVerse), a member of S&amp;P Global's 451 Alliance, and completing a Web Development Internship with InAmigos Foundation.
              </p>
              <p>
                I have also pursued learning and certifications across AI, Generative AI, Agentic AI Systems, and Prompt Engineering through programs and platforms including Scaler, Microsoft, Intel, Oracle, Claude, and more.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Professional Highlights */}
      <section className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6">
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-blue-600 uppercase tracking-wider">
            Background &amp; Credentials
          </div>
          <h2 className="font-display text-xl sm:text-2xl font-bold text-slate-900">
            Professional Highlights
          </h2>
          <p className="text-sm text-slate-600">
            Programs, communities, internships, and technical specializations across AI and web engineering.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {PROFESSIONAL_HIGHLIGHTS.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.title}
                className="group bg-slate-50/70 hover:bg-white border border-slate-200 hover:border-blue-300 rounded-xl p-4 sm:p-5 transition-colors flex items-start gap-3.5"
              >
                <div className="w-9 h-9 rounded-lg bg-white border border-slate-200 group-hover:border-blue-200 group-hover:bg-blue-50 text-slate-700 group-hover:text-blue-600 flex items-center justify-center shrink-0 transition-colors">
                  <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="text-[11px] font-medium text-slate-500">{item.category}</div>
                  <div className="font-display text-sm font-semibold text-slate-900 leading-snug">
                    {item.title}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* The Vision Behind Exam Planner */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[#0F172A] via-slate-900 to-slate-950 text-white border border-slate-800 rounded-2xl p-6 sm:p-10 space-y-6">
        <div className="flex items-center gap-2.5 text-xs font-semibold text-blue-400 uppercase tracking-wider">
          <Compass className="w-4 h-4" />
          <span>Product Philosophy</span>
        </div>

        <div className="max-w-3xl space-y-5">
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-white tracking-tight text-balance">
            The Vision Behind Exam Planner
          </h2>

          <div className="space-y-4 text-sm sm:text-base text-slate-300 leading-relaxed">
            <p>
              I believe technology should simplify work, reduce repetitive effort, and help people make better use of their time.
            </p>
            <p>
              Exam Planner was created with this vision: to make examination seating management more organised, accurate, and efficient for educational institutions.
            </p>
            <p>
              My goal is to build technology that addresses practical challenges rather than simply adding complexity.
            </p>
          </div>
        </div>

        <div className="pt-4 border-t border-slate-800/90">
          <p className="font-display text-base sm:text-lg font-semibold text-blue-300 tracking-tight">
            Building practical technology. Solving real problems. Creating meaningful impact.
          </p>
        </div>
      </section>

      {/* Connect With the Founder */}
      <section className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-1.5 max-w-xl">
            <h2 className="font-display text-xl font-bold text-slate-900">
              Connect With the Founder
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Reach out for product feedback, institutional support, or collaborations on AI and web engineering.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <a
              href="https://www.linkedin.com/in/shyam-agarwal-ai/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              <Linkedin className="w-4 h-4 shrink-0" />
              <span>LinkedIn</span>
              <ArrowUpRight className="w-4 h-4 shrink-0" />
            </a>

            <a
              href="https://shyamagarwal.edgeone.app"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
            >
              <Globe className="w-4 h-4 text-blue-600 shrink-0" />
              <span>Portfolio</span>
              <ArrowUpRight className="w-4 h-4 text-slate-400 shrink-0" />
            </a>

            <a
              href="mailto:agarwalpiyush263@gmail.com"
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <Mail className="w-4 h-4 text-slate-500 shrink-0" />
              <span>Email</span>
            </a>

            <a
              href="tel:7461020391"
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-lg transition-colors font-mono tabular-nums"
            >
              <Phone className="w-4 h-4 text-slate-500 shrink-0" />
              <span>7461020391</span>
            </a>
          </div>
        </div>
      </section>
    </div>
  );

  if (!isPublicView) {
    return pageBody;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Public Top Bar */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <Link to="/login" className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
            <BrandLogo size={30} variant="dark" />
            <span className="font-display font-bold text-base tracking-tight text-slate-900">
              EXAM PLANNER
            </span>
          </Link>

          <div className="flex items-center gap-3 shrink-0">
            <Link
              to="/login"
              className="px-4 py-2 text-xs sm:text-sm font-medium text-white bg-[#0F172A] hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap"
            >
              Sign In
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1200px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
        {pageBody}
      </main>

      <PublicFooter />
    </div>
  );
}
