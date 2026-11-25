import { ArrowUpRight, Globe, Linkedin, Mail, Phone, User } from 'lucide-react';
import { Link } from 'react-router-dom';
import { BrandLogo } from './BrandLogo';

export function PublicFooter() {
  return (
    <footer className="bg-white border-t border-slate-200 text-slate-600 no-print">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 pb-8 border-b border-slate-200">
          {/* Brand & Tagline */}
          <div className="md:col-span-4 space-y-3">
            <div className="flex items-center gap-2.5">
              <BrandLogo size={28} variant="dark" />
              <span className="font-display font-bold text-sm tracking-tight text-slate-900">
                EXAM PLANNER
              </span>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed max-w-xs">
              Smart Examination Seating. Zero Manual Allocation.
            </p>
          </div>

          {/* Founder */}
          <div className="md:col-span-2 space-y-2.5">
            <h2 className="text-xs font-semibold text-slate-900 uppercase tracking-wider">
              Founder
            </h2>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
                <User className="w-4 h-4 text-slate-400 shrink-0" />
                <span>Shyam Agarwal</span>
              </div>
              <div>
                <Link
                  to="/about"
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline transition-colors"
                >
                  <span>About the Founder</span>
                </Link>
              </div>
            </div>
          </div>

          {/* Need Help / Contact */}
          <div className="md:col-span-3 space-y-2.5">
            <h2 className="text-xs font-semibold text-slate-900 uppercase tracking-wider">
              Need Help?
            </h2>
            <ul className="space-y-2 text-sm">
              <li>
                <a
                  href="tel:7461020391"
                  className="inline-flex items-center gap-2 text-slate-600 hover:text-blue-600 transition-colors"
                >
                  <Phone className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="font-mono tabular-nums">7461020391</span>
                </a>
              </li>
              <li>
                <a
                  href="mailto:agarwalpiyush263@gmail.com"
                  className="inline-flex items-center gap-2 text-slate-600 hover:text-blue-600 transition-colors break-all"
                >
                  <Mail className="w-4 h-4 text-slate-400 shrink-0" />
                  <span>agarwalpiyush263@gmail.com</span>
                </a>
              </li>
            </ul>
          </div>

          {/* Connect */}
          <div className="md:col-span-3 space-y-2.5">
            <h2 className="text-xs font-semibold text-slate-900 uppercase tracking-wider">
              Connect
            </h2>
            <ul className="space-y-2 text-sm">
              <li>
                <a
                  href="https://www.linkedin.com/in/shyam-agarwal-ai/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-slate-600 hover:text-blue-600 transition-colors group"
                >
                  <Linkedin className="w-4 h-4 text-slate-400 group-hover:text-blue-600 shrink-0" />
                  <span>LinkedIn</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-600 shrink-0" />
                </a>
              </li>
              <li>
                <a
                  href="https://shyamagarwal.edgeone.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-slate-600 hover:text-blue-600 transition-colors group"
                >
                  <Globe className="w-4 h-4 text-slate-400 group-hover:text-blue-600 shrink-0" />
                  <span>Portfolio</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-600 shrink-0" />
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="pt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-500">
          <p>© 2026 Exam Planner. All rights reserved.</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>Founder: Shyam Agarwal</span>
            <span aria-hidden="true">·</span>
            <a href="tel:7461020391" className="hover:text-slate-800 transition-colors font-mono tabular-nums">
              +91 7461020391
            </a>
            <span aria-hidden="true">·</span>
            <a href="mailto:agarwalpiyush263@gmail.com" className="hover:text-slate-800 transition-colors">
              agarwalpiyush263@gmail.com
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
