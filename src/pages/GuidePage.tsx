import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bot,
  Building2,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  Grid2x2,
  Hash,
  HelpCircle,
  History,
  Info,
  Layers,
  LayoutDashboard,
  Printer,
  Search,
  ShieldCheck,
  UserPlus,
  Users,
  X
} from 'lucide-react';
import { useWorkspace } from '../context/ExamWorkspaceContext';

interface GuideSectionMeta {
  id: string;
  number: string;
  title: string;
  shortTitle: string;
  summary: string;
  icon: React.ComponentType<{ className?: string }>;
  keywords: string[];
}

const GUIDE_SECTIONS: GuideSectionMeta[] = [
  {
    id: 'getting-started',
    number: 'Section 1',
    title: 'Getting Started',
    shortTitle: '1. Getting Started',
    summary:
      'Register your institution, sign in safely, understand your private data space, and navigate the dashboard.',
    icon: LayoutDashboard,
    keywords: [
      'register',
      'institution',
      'login',
      'sign in',
      'google',
      'password',
      'dashboard',
      'sidebar',
      'private',
      'save',
      'previous examinations',
      'firebase'
    ]
  },
  {
    id: 'create-examination',
    number: 'Section 2',
    title: 'Create Examination (4-Step Wizard)',
    shortTitle: '2. Create Examination',
    summary:
      'Complete walkthrough of Exam Details, Student Information (4 methods), Classroom Configuration, and Seating Mode.',
    icon: FilePlus2,
    keywords: [
      'create examination',
      'exam details',
      'examination name',
      'type',
      'academic year',
      'date',
      'time',
      'subject',
      'class',
      'course',
      'semester',
      'notes',
      'mandatory',
      'optional',
      'student information',
      'roll number range',
      '8601000001',
      '8601000599',
      'leading zeros',
      'alphanumeric',
      'csv',
      'excel',
      'xlsx',
      'manual entry',
      'paste excel data',
      'classroom configuration',
      'uniform classroom generator',
      'rows',
      'benches',
      '300',
      '600',
      'disabled benches',
      'seating mode',
      'one student per bench',
      'two students per bench'
    ]
  },
  {
    id: 'generate-seating-plan',
    number: 'Section 3',
    title: 'Generate Seating Plan',
    shortTitle: '3. Generate Seating Plan',
    summary:
      'How seats are assigned across classrooms, rows, and benches, and how sequential and alternate strategies work.',
    icon: Layers,
    keywords: [
      'generate seating plan',
      'generate & audit',
      'allocate',
      'sequential',
      'alternate',
      'section separation',
      'custom staggered',
      'unused seats',
      'empty seats',
      'capacity calculation'
    ]
  },
  {
    id: 'validation-ai-audit',
    number: 'Section 4',
    title: 'Data Validation & AI Audit',
    shortTitle: '4. Validation & AI Audit',
    summary:
      'Understand the 15-point audit, AI agents (Scanner, Validation, Capacity, Audit, PDF Quality, Orchestrator), and status meanings.',
    icon: ShieldCheck,
    keywords: [
      'ai',
      'audit',
      'validation',
      'data scanner',
      'data validation agent',
      'classroom capacity agent',
      'seating audit agent',
      'pdf quality checker',
      'orchestrator',
      'verified',
      'warning',
      'critical error',
      'failed',
      'missing student names',
      'duplicate roll numbers',
      'missing roll numbers',
      'invalid roll number',
      'locked',
      '15-point'
    ]
  },
  {
    id: 'seating-preview-search',
    number: 'Section 5',
    title: 'Seating Preview & Search',
    shortTitle: '5. Preview & Search',
    summary:
      'Inspect classroom grids and row tables, identify Seat 1, Seat 2, and empty seats, and search any roll number.',
    icon: Search,
    keywords: [
      'seating preview',
      'classroom grid',
      'row table',
      'seat 1',
      'seat 2',
      'empty',
      'search',
      'roll number',
      '8601000001',
      'find student',
      'classroom',
      'row',
      'bench'
    ]
  },
  {
    id: 'pdf-reports-printing',
    number: 'Section 6',
    title: 'PDF Reports & Printing',
    shortTitle: '6. PDF Reports & Printing',
    summary:
      'Download Full Examination PDFs, Individual Classroom Print Sheets, Student Allocation CSVs, and Audit summaries.',
    icon: FileText,
    keywords: [
      'pdf',
      'print',
      'download',
      'format a',
      'format b',
      'full examination seating plan',
      'individual classroom pdf',
      'student allocation report',
      'csv',
      'audit report',
      'generated plans',
      'portrait',
      'landscape',
      'locked'
    ]
  },
  {
    id: 'examination-history',
    number: 'Section 7',
    title: 'Examination History',
    shortTitle: '7. Examination History',
    summary:
      'Find, reopen, edit, duplicate, regenerate, archive, or delete past examinations safely.',
    icon: History,
    keywords: [
      'history',
      'previous examinations',
      'reopen',
      'edit',
      'update students',
      'modify classrooms',
      'regenerate',
      'archive',
      'delete',
      'duplicate',
      'versions',
      'audit trail'
    ]
  },
  {
    id: 'faq-troubleshooting',
    number: 'Section 8',
    title: 'Common Questions & Troubleshooting',
    shortTitle: '8. FAQs & Troubleshooting',
    summary:
      'Clear answers to everyday questions about missing names, Excel files, capacity mismatches, and locked PDFs.',
    icon: HelpCircle,
    keywords: [
      'faq',
      'questions',
      'troubleshooting',
      'without student names',
      'excel spreadsheet',
      '599 students',
      '600 seats',
      'two students sit on one bench',
      'insufficient seating capacity',
      'pdf download locked',
      'roll number is missing',
      'student name is missing',
      'individual classroom pdf'
    ]
  }
];

interface FaqItem {
  id: string;
  question: string;
  answer: string;
  relatedSectionId?: string;
}

const FAQ_ITEMS: FaqItem[] = [
  {
    id: 'faq-no-names',
    question: 'Can I create a seating plan without student names?',
    answer:
      'Yes. Roll numbers are sufficient. Student names are completely optional across Roll Number Range, CSV/Excel Upload, Manual Entry, and Paste Excel Data. Any student without a name is clearly shown as "Name Not Provided" in tables and PDFs and still receives a valid seat.',
    relatedSectionId: 'create-examination'
  },
  {
    id: 'faq-excel',
    question: 'Can I upload an Excel spreadsheet?',
    answer:
      'Yes. CSV (.csv) and Excel (.xlsx, .xls) uploads are supported in Step 2 (Student Information) and on the Student Data page. You can also download ready-made Excel or CSV templates directly from the Upload tab.',
    relatedSectionId: 'create-examination'
  },
  {
    id: 'faq-599-600',
    question: 'What if I have 599 students and 600 seats?',
    answer:
      'The application allocates all 599 students and leaves 1 seat empty (marked as EMPTY). Having extra seats is completely valid and passes the capacity check without any errors.',
    relatedSectionId: 'generate-seating-plan'
  },
  {
    id: 'faq-two-per-bench',
    question: 'Can two students sit on one bench?',
    answer:
      'Yes. In Step 4 (or in the Seating Planner / Quick Generate), select "Mode 2: Two Students Per Bench". Each active bench will then hold Seat 1 and Seat 2, doubling your total seating capacity.',
    relatedSectionId: 'create-examination'
  },
  {
    id: 'faq-insufficient-capacity',
    question: 'What if I have insufficient seating capacity?',
    answer:
      'You must add more seats before generating a verified seating plan. You can either increase the number of classrooms, add more rows or benches per row in Classroom Configuration, enable any disabled rooms/benches, or switch from One Student Per Bench to Two Students Per Bench.',
    relatedSectionId: 'create-examination'
  },
  {
    id: 'faq-pdf-locked',
    question: 'Why is my PDF download locked?',
    answer:
      'The application requires all applicable critical audit checks to pass (Audit Status must be VERIFIED) before verified PDF export is unlocked. Check the red Critical Error messages in the Seating Planner audit panel — common causes are duplicate roll numbers, insufficient seating capacity, or empty roll numbers.',
    relatedSectionId: 'validation-ai-audit'
  },
  {
    id: 'faq-missing-roll',
    question: 'What if a roll number is missing?',
    answer:
      'Review the student list in Student Data and add the missing record if a continuous roll-number range is expected. When you generate a list using Roll Number Range, the expected count is locked to that range; for uploaded Excel/CSV files, missing sequence numbers appear only as an informational warning.',
    relatedSectionId: 'validation-ai-audit'
  },
  {
    id: 'faq-missing-name',
    question: 'What if the student name is missing?',
    answer:
      'No problem. The student will still be allocated a seat using their roll number. Missing names only trigger a gentle informational warning and never block seating generation or PDF downloads.',
    relatedSectionId: 'validation-ai-audit'
  },
  {
    id: 'faq-individual-pdf',
    question: 'Can I download individual classroom PDFs?',
    answer:
      'Yes. In the Seating Planner, click "Download Room PDF" on any classroom card, or open the PDF Reports page and use the "Individual Classroom PDF" card to pick a specific room and download its printable sheet.',
    relatedSectionId: 'pdf-reports-printing'
  }
];

export function GuidePage() {
  const navigate = useNavigate();
  const { activeExam, currentAllocation } = useWorkspace();

  const [activeSectionId, setActiveSectionId] = useState<string>('getting-started');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedPanels, setExpandedPanels] = useState<Record<string, boolean>>({
    'step1-details': true,
    'step2-students': true,
    'step3-classrooms': true,
    'step4-mode': true,
    'opt-range': true,
    'opt-upload': true,
    'opt-manual': true,
    'opt-paste': true
  });
  const [openFaqIds, setOpenFaqIds] = useState<Record<string, boolean>>({
    'faq-no-names': true,
    'faq-pdf-locked': true
  });
  const [demoLookupInput, setDemoLookupInput] = useState<string>('8601000001');

  const togglePanel = (key: string) => {
    setExpandedPanels((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleFaq = (id: string) => {
    setOpenFaqIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const expandAllSubpanels = (open: boolean) => {
    setExpandedPanels({
      'step1-details': open,
      'step2-students': open,
      'step3-classrooms': open,
      'step4-mode': open,
      'opt-range': open,
      'opt-upload': open,
      'opt-manual': open,
      'opt-paste': open
    });
    const nextFaqs: Record<string, boolean> = {};
    FAQ_ITEMS.forEach((f) => {
      nextFaqs[f.id] = open;
    });
    setOpenFaqIds(nextFaqs);
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const matchingSections = useMemo(() => {
    if (!normalizedQuery) return GUIDE_SECTIONS;
    return GUIDE_SECTIONS.filter((sec) => {
      const hay = [sec.number, sec.title, sec.summary, ...sec.keywords].join(' ').toLowerCase();
      return hay.includes(normalizedQuery);
    });
  }, [normalizedQuery]);

  const matchingFaqs = useMemo(() => {
    if (!normalizedQuery) return FAQ_ITEMS;
    return FAQ_ITEMS.filter(
      (f) =>
        f.question.toLowerCase().includes(normalizedQuery) ||
        f.answer.toLowerCase().includes(normalizedQuery)
    );
  }, [normalizedQuery]);

  const displayedSections = normalizedQuery ? matchingSections : [GUIDE_SECTIONS.find((s) => s.id === activeSectionId) ?? GUIDE_SECTIONS[0]];

  const currentIdx = GUIDE_SECTIONS.findIndex((s) => s.id === activeSectionId);
  const prevSection = currentIdx > 0 ? GUIDE_SECTIONS[currentIdx - 1] : null;
  const nextSection = currentIdx < GUIDE_SECTIONS.length - 1 ? GUIDE_SECTIONS[currentIdx + 1] : null;

  const jumpToSection = (id: string) => {
    setSearchQuery('');
    setActiveSectionId(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Live worked example lookup against actual generated seating plan (never invents conflicting fixed data)
  const liveLookupResult = useMemo(() => {
    const q = demoLookupInput.trim().toLowerCase();
    if (!q || !currentAllocation) return null;
    return (
      currentAllocation.lookupIndex.find((item) => item.rollNumber.toLowerCase() === q) ??
      currentAllocation.lookupIndex.find((item) => item.rollNumber.toLowerCase().includes(q)) ??
      null
    );
  }, [demoLookupInput, currentAllocation]);

  return (
    <div className="space-y-6">
      {/* Top Documentation Header */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-blue-600 uppercase tracking-wider">
              <BookOpen className="w-4 h-4" />
              <span>User Manual & Step-by-Step Guide</span>
            </div>
            <h2 className="font-display text-2xl font-bold text-slate-900">
              How to Use Exam Planner
            </h2>
            <p className="text-sm text-slate-600 max-w-2xl leading-relaxed">
              Plain-English instructions for school, college, and university coordinators. Learn how to enter examination details, import roll numbers, configure classrooms, audit seating plans, and download printable PDFs.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs sm:text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Dashboard
            </button>
            <button
              type="button"
              onClick={() => navigate('/create-exam')}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs sm:text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap"
            >
              <FilePlus2 className="w-4 h-4" />
              Start Creating Examination
            </button>
          </div>
        </div>

        {/* Search Bar + Quick Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 border-t border-slate-200">
          <div className="relative flex-1 max-w-xl">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search the guide... (e.g. roll number, Excel, PDF locked, 600 seats)"
              aria-label="Search the guide"
              className="w-full pl-10 pr-9 py-2.5 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear guide search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => expandAllSubpanels(true)}
              className="px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              Expand All
            </button>
            <button
              type="button"
              onClick={() => expandAllSubpanels(false)}
              className="px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              Collapse All
            </button>
          </div>
        </div>

        {normalizedQuery && (
          <div className="text-xs text-slate-600 flex flex-wrap items-center gap-2">
            <span>
              Showing{' '}
              <strong className="font-mono text-slate-900">{matchingSections.length}</strong>{' '}
              matching section(s)
              {matchingFaqs.length > 0 && (
                <>
                  {' '}
                  and <strong className="font-mono text-slate-900">{matchingFaqs.length}</strong>{' '}
                  matching FAQ(s)
                </>
              )}{' '}
              for "{searchQuery}".
            </span>
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="text-blue-600 hover:underline font-medium"
            >
              Show single section view
            </button>
          </div>
        )}
      </section>

      {/* Documentation Grid: Left Navigation + Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left-Side Guide Navigation */}
        <aside className="lg:col-span-3 lg:sticky lg:top-20 bg-white border border-slate-200 rounded-xl p-3 space-y-1">
          <div className="px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            Guide Contents
          </div>
          <nav aria-label="Guide Sections" className="space-y-1">
            {GUIDE_SECTIONS.map((sec) => {
              const Icon = sec.icon;
              const isActive = !normalizedQuery && sec.id === activeSectionId;
              const isMatch = normalizedQuery
                ? matchingSections.some((m) => m.id === sec.id)
                : false;

              return (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => jumpToSection(sec.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-xs sm:text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : isMatch
                      ? 'bg-blue-50 text-blue-800 hover:bg-blue-100'
                      : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{sec.shortTitle}</span>
                </button>
              );
            })}
          </nav>

          <div className="pt-3 mt-3 border-t border-slate-200 px-3 pb-1 space-y-2">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              Quick Shortcuts
            </div>
            <div className="flex flex-col gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => navigate('/create-exam')}
                className="text-left text-blue-600 hover:underline font-medium"
              >
                Open Create Examination →
              </button>
              <button
                type="button"
                onClick={() => navigate('/planner')}
                className="text-left text-blue-600 hover:underline font-medium"
              >
                Open Seating Planner →
              </button>
              <button
                type="button"
                onClick={() => navigate('/reports')}
                className="text-left text-blue-600 hover:underline font-medium"
              >
                Open PDF Reports →
              </button>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="lg:col-span-9 space-y-6 min-w-0">
          {normalizedQuery && matchingSections.length === 0 && matchingFaqs.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
              <Search className="w-8 h-8 text-slate-300 mx-auto" />
              <h3 className="font-display text-lg font-bold text-slate-900">
                No guide topics matched "{searchQuery}"
              </h3>
              <p className="text-sm text-slate-500 max-w-md mx-auto">
                Try searching with simpler words like "roll number", "Excel", "bench", "PDF", "audit", or "history".
              </p>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
              >
                Reset Search
              </button>
            </div>
          ) : (
            <>
              {displayedSections.map((sec) => (
                <article
                  key={sec.id}
                  className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6"
                >
                  {/* Section Title Header */}
                  <div className="pb-5 border-b border-slate-200 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-blue-600 uppercase tracking-wider">
                        {sec.number}
                      </span>
                      {normalizedQuery && (
                        <button
                          type="button"
                          onClick={() => jumpToSection(sec.id)}
                          className="text-xs font-medium text-blue-600 hover:underline"
                        >
                          Focus this section →
                        </button>
                      )}
                    </div>
                    <h3 className="font-display text-xl sm:text-2xl font-bold text-slate-900">
                      {sec.title}
                    </h3>
                    <p className="text-sm text-slate-600 leading-relaxed">{sec.summary}</p>
                  </div>

                  {/* SECTION 1: GETTING STARTED */}
                  {sec.id === 'getting-started' && (
                    <div className="space-y-6">
                      <InfoBanner
                        icon={Building2}
                        title="Private Examination Space for Every Institution"
                        body="Every school, college, university, or coaching institute gets its own private, isolated workspace stored securely in Cloud Firestore. Other institutions cannot view, edit, or access your students, classrooms, or seating plans."
                      />

                      <div className="space-y-4">
                        <h4 className="font-display text-base font-bold text-slate-900">
                          How to Register & Sign In
                        </h4>
                        <div className="grid sm:grid-cols-2 gap-4">
                          <InstructionCard
                            title="1. Registering Your Institution (First-Time Users)"
                            items={[
                              'Open the Exam Planner login screen and click the "Create New Account" tab.',
                              'Enter your Personal Details: Full Name, Email Address, Password (at least 6 characters), and Confirm Password.',
                              'Enter your Institution Details: Institution Name, Type (School, College, University, Coaching Institute, Examination Center, or Other), Address, City, State, PIN Code, and Mobile Number.',
                              'Optionally upload your institution logo (PNG/JPG) so it prints at the top of official PDF seating sheets.',
                              'Click "Create Account & Open Dashboard". Your private workspace opens immediately.'
                            ]}
                          />
                          <InstructionCard
                            title="2. Logging In & Returning Later"
                            items={[
                              'Enter your registered Email Address and Password and click "Login".',
                              'Forgot your password? Click "Forgot password?", enter your email, and click "Send Reset Email" to receive a reset link.',
                              'To update your logo or address later, open "Institution Profile" from the sidebar.'
                            ]}
                          />
                        </div>
                      </div>

                      <div className="space-y-3">
                        <h4 className="font-display text-base font-bold text-slate-900">
                          Understanding the Dashboard & Sidebar Navigation
                        </h4>
                        <p className="text-sm text-slate-600 leading-relaxed">
                          Once signed in, the Dashboard shows your total saved examinations, registered students, configured classrooms, and generated plans. It also provides six Quick Action cards and a <strong>Quick Seating Plan Generation</strong> form for simple roll-range exams. Use the dark left sidebar to move between every tool:
                        </p>
                        <div className="overflow-x-auto border border-slate-200 rounded-lg">
                          <table className="w-full text-left border-collapse text-xs sm:text-sm">
                            <thead>
                              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                                <th className="py-2.5 px-4 font-semibold">Sidebar Tab</th>
                                <th className="py-2.5 px-4 font-semibold">What It Does</th>
                                <th className="py-2.5 px-4 font-semibold">When to Use It</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-slate-700">
                              <tr>
                                <td className="py-2.5 px-4 font-semibold text-slate-900">Dashboard</td>
                                <td className="py-2.5 px-4">Overview metrics, quick actions, and 1-click Quick Seating Plan Generation.</td>
                                <td className="py-2.5 px-4">Starting point after login or fast roll-range setup.</td>
                              </tr>
                              <tr>
                                <td className="py-2.5 px-4 font-semibold text-slate-900">Create Examination</td>
                                <td className="py-2.5 px-4">4-step wizard for exam details, students, classrooms, and seating mode.</td>
                                <td className="py-2.5 px-4">Recommended for every new examination.</td>
                              </tr>
                              <tr>
                                <td className="py-2.5 px-4 font-semibold text-slate-900">Student Data</td>
                                <td className="py-2.5 px-4">Add, import, search, or edit students in the currently selected exam.</td>
                                <td className="py-2.5 px-4">Updating student lists for an existing exam.</td>
                              </tr>
                              <tr>
                                <td className="py-2.5 px-4 font-semibold text-slate-900">Classroom Setup</td>
                                <td className="py-2.5 px-4">Edit rooms, rows, benches, or mark broken benches disabled.</td>
                                <td className="py-2.5 px-4">Adjusting hall capacity for the active exam.</td>
                              </tr>
                              <tr>
                                <td className="py-2.5 px-4 font-semibold text-slate-900">Seating Planner</td>
                                <td className="py-2.5 px-4">Generate/regenerate seats, inspect 15-point audit, search roll numbers, preview grids.</td>
                                <td className="py-2.5 px-4">Reviewing allocations and finding any student seat.</td>
                              </tr>
                              <tr>
                                <td className="py-2.5 px-4 font-semibold text-slate-900">Generated Plans</td>
                                <td className="py-2.5 px-4">View all saved plan versions (v1, v2, etc.) for the active exam.</td>
                                <td className="py-2.5 px-4">Comparing or restoring an earlier version.</td>
                              </tr>
                              <tr>
                                <td className="py-2.5 px-4 font-semibold text-slate-900">PDF Reports</td>
                                <td className="py-2.5 px-4">Download Full Seating Plan PDFs, Individual Room Print Sheets, and CSVs.</td>
                                <td className="py-2.5 px-4">Printing sheets for notice boards and invigilators.</td>
                              </tr>
                              <tr>
                                <td className="py-2.5 px-4 font-semibold text-slate-900">Examination History</td>
                                <td className="py-2.5 px-4">Browse, filter, reopen, edit, duplicate, archive, or delete saved exams.</td>
                                <td className="py-2.5 px-4">Accessing previous exams and audit trails.</td>
                              </tr>
                              <tr>
                                <td className="py-2.5 px-4 font-semibold text-slate-900">Institution Profile & Settings</td>
                                <td className="py-2.5 px-4">Update institution details/logo, toggle AI Agents, or reset password.</td>
                                <td className="py-2.5 px-4">Account upkeep and privacy controls.</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div className="space-y-2 text-sm text-slate-600 leading-relaxed">
                        <h4 className="font-display text-base font-bold text-slate-900">
                          Saving & Accessing Previous Examinations
                        </h4>
                        <p>
                          Whenever you click <strong>"Save Draft"</strong> or <strong>"Generate & Audit Seating Plan"</strong>, your examination is saved directly to your institution's cloud database. To switch between saved examinations at any time, either use the <strong>Active Examination dropdown</strong> at the top right of the header or open <strong>Examination History</strong> in the sidebar.
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 pt-2">
                        <LearnMoreLink
                          label="Learn More: Step-by-Step Examination Wizard"
                          onClick={() => jumpToSection('create-examination')}
                        />
                        <LearnMoreLink
                          label="Go to Institution Profile"
                          onClick={() => navigate('/profile')}
                          isRoute
                        />
                      </div>
                    </div>
                  )}

                  {/* SECTION 2: CREATE EXAMINATION */}
                  {sec.id === 'create-examination' && (
                    <div className="space-y-6">
                      <InfoBanner
                        icon={FilePlus2}
                        title="Important First Step: Start from Create Examination"
                        body='Always begin a new exam by clicking "Create Examination" in the left sidebar or "New Examination" in the top bar. This opens a clean, fresh 4-step examination workspace so old student lists or classrooms from previous exams never mix into your new exam.'
                      />

                      {/* STEP 1: EXAM DETAILS */}
                      <CollapsibleBlock
                        id="step1-details"
                        isOpen={Boolean(expandedPanels['step1-details'])}
                        onToggle={() => togglePanel('step1-details')}
                        badge="Step 1 of 4"
                        title="STEP 1: EXAM DETAILS"
                        subtitle="Basic examination information printed on your seating sheets and official PDFs."
                      >
                        <div className="space-y-4">
                          <p className="text-sm text-slate-600 leading-relaxed">
                            This step records the identity and schedule of your examination. Four fields are <strong>mandatory</strong> before you can click Continue to Step 2; the remaining five fields are <strong>optional</strong>. Note: If you click <em>Save Draft</em> early, at least the Examination Name is required.
                          </p>

                          <div className="overflow-x-auto border border-slate-200 rounded-lg">
                            <table className="w-full text-left border-collapse text-xs sm:text-sm">
                              <thead>
                                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                                  <th className="py-2.5 px-3.5 font-semibold">Field Name</th>
                                  <th className="py-2.5 px-3.5 font-semibold">Required?</th>
                                  <th className="py-2.5 px-3.5 font-semibold">What to Enter & Why</th>
                                  <th className="py-2.5 px-3.5 font-semibold">Example Input</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 text-slate-700">
                                <tr>
                                  <td className="py-2.5 px-3.5 font-semibold text-slate-900">Examination Name</td>
                                  <td className="py-2.5 px-3.5 font-semibold text-red-700">Mandatory</td>
                                  <td className="py-2.5 px-3.5">The full title of the exam. Appears as the main heading on every PDF and in History.</td>
                                  <td className="py-2.5 px-3.5 font-mono text-xs bg-slate-50">BCA Semester 1 Examination 2026</td>
                                </tr>
                                <tr>
                                  <td className="py-2.5 px-3.5 font-semibold text-slate-900">Examination Type</td>
                                  <td className="py-2.5 px-3.5 font-semibold text-red-700">Mandatory</td>
                                  <td className="py-2.5 px-3.5">Select from: Semester Final, Mid Term, Annual Examination, Unit Test, Mock / Entrance Test, or Practical / Viva.</td>
                                  <td className="py-2.5 px-3.5 font-mono text-xs bg-slate-50">Mid Term / Semester Final</td>
                                </tr>
                                <tr>
                                  <td className="py-2.5 px-3.5 font-semibold text-slate-900">Academic Year</td>
                                  <td className="py-2.5 px-3.5 font-semibold text-red-700">Mandatory</td>
                                  <td className="py-2.5 px-3.5">The academic session for record keeping and archival filtering.</td>
                                  <td className="py-2.5 px-3.5 font-mono text-xs bg-slate-50">2026–2027</td>
                                </tr>
                                <tr>
                                  <td className="py-2.5 px-3.5 font-semibold text-slate-900">Exam Date</td>
                                  <td className="py-2.5 px-3.5 font-semibold text-red-700">Mandatory</td>
                                  <td className="py-2.5 px-3.5">Select the date on which the examination takes place.</td>
                                  <td className="py-2.5 px-3.5 font-mono text-xs bg-slate-50">2026-11-24</td>
                                </tr>
                                <tr>
                                  <td className="py-2.5 px-3.5 font-semibold text-slate-900">Examination Time</td>
                                  <td className="py-2.5 px-3.5 text-slate-500">Optional</td>
                                  <td className="py-2.5 px-3.5">Start time or duration window printed on classroom sheets.</td>
                                  <td className="py-2.5 px-3.5 font-mono text-xs bg-slate-50">09:30 AM – 12:30 PM</td>
                                </tr>
                                <tr>
                                  <td className="py-2.5 px-3.5 font-semibold text-slate-900">Subject</td>
                                  <td className="py-2.5 px-3.5 text-slate-500">Optional</td>
                                  <td className="py-2.5 px-3.5">The subject being examined (leave blank for multi-subject halls).</td>
                                  <td className="py-2.5 px-3.5 font-mono text-xs bg-slate-50">Mathematics</td>
                                </tr>
                                <tr>
                                  <td className="py-2.5 px-3.5 font-semibold text-slate-900">Class / Course</td>
                                  <td className="py-2.5 px-3.5 text-slate-500">Optional</td>
                                  <td className="py-2.5 px-3.5">Class, degree programme, or stream taking the exam.</td>
                                  <td className="py-2.5 px-3.5 font-mono text-xs bg-slate-50">BCA 1st Year</td>
                                </tr>
                                <tr>
                                  <td className="py-2.5 px-3.5 font-semibold text-slate-900">Semester / Term</td>
                                  <td className="py-2.5 px-3.5 text-slate-500">Optional</td>
                                  <td className="py-2.5 px-3.5">Semester or term label if applicable to your institution.</td>
                                  <td className="py-2.5 px-3.5 font-mono text-xs bg-slate-50">Semester 1</td>
                                </tr>
                                <tr>
                                  <td className="py-2.5 px-3.5 font-semibold text-slate-900">Coordinator Notes</td>
                                  <td className="py-2.5 px-3.5 text-slate-500">Optional</td>
                                  <td className="py-2.5 px-3.5">Extra instructions for room invigilators or seating notices.</td>
                                  <td className="py-2.5 px-3.5 font-mono text-xs bg-slate-50">Calculators not permitted</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>

                          <CommonMistakes
                            mistakes={[
                              'Leaving Examination Name blank — you cannot move to Step 2 or save a draft without a name.',
                              'Using the exact same name for different dates — include the semester or subject in the Examination Name so it is easy to find in History later.'
                            ]}
                          />
                        </div>
                      </CollapsibleBlock>

                      {/* STEP 2: STUDENT INFORMATION */}
                      <CollapsibleBlock
                        id="step2-students"
                        isOpen={Boolean(expandedPanels['step2-students'])}
                        onToggle={() => togglePanel('step2-students')}
                        badge="Step 2 of 4"
                        title="STEP 2: STUDENT INFORMATION"
                        subtitle="Add your students to the examination. You can generate roll numbers automatically, upload an existing student list, paste information from Excel, or enter students manually."
                      >
                        <div className="space-y-4">
                          <p className="text-sm text-slate-600 leading-relaxed">
                            Choose any of the four input methods below (you can even combine them using <strong>Append to Existing List</strong>). At least one student record with a valid Roll Number is required before moving to Step 3.
                          </p>

                          {/* Option 1 */}
                          <div className="border border-slate-200 rounded-lg p-4 space-y-3">
                            <button
                              type="button"
                              onClick={() => togglePanel('opt-range')}
                              className="w-full flex items-center justify-between gap-2 text-left"
                            >
                              <div className="flex items-center gap-2.5">
                                <Hash className="w-4 h-4 text-blue-600 shrink-0" />
                                <span className="font-display font-bold text-sm text-slate-900">
                                  Option 1: Roll Number Range (Automatic Generator)
                                </span>
                              </div>
                              {expandedPanels['opt-range'] ? (
                                <ChevronDown className="w-4 h-4 text-slate-400" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-slate-400" />
                              )}
                            </button>

                            {expandedPanels['opt-range'] && (
                              <div className="pt-2 space-y-3 text-sm text-slate-600 border-t border-slate-100">
                                <p>
                                  <strong>What it means & why use it:</strong> Automatically creates all student records in seconds when your candidates have continuous roll numbers — no spreadsheet needed.
                                </p>
                                <div className="grid sm:grid-cols-2 gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3.5 text-xs">
                                  <div>
                                    <div className="font-semibold text-slate-800">Starting Roll Number</div>
                                    <div className="text-slate-600 mt-0.5">Enter the first roll number.</div>
                                    <div className="font-mono font-semibold text-blue-700 mt-1">
                                      Example: 8601000001
                                    </div>
                                  </div>
                                  <div>
                                    <div className="font-semibold text-slate-800">Ending Roll Number</div>
                                    <div className="text-slate-600 mt-0.5">Enter the last roll number.</div>
                                    <div className="font-mono font-semibold text-blue-700 mt-1">
                                      Example: 8601000599
                                    </div>
                                  </div>
                                </div>
                                <div className="bg-slate-900 text-slate-100 rounded-lg p-3.5 text-xs font-mono space-y-1">
                                  <div className="text-slate-400 font-sans">Generated Output (599 students):</div>
                                  <div>8601000001</div>
                                  <div>8601000002</div>
                                  <div>8601000003</div>
                                  <div className="text-slate-400">...</div>
                                  <div>8601000599</div>
                                </div>
                                <ul className="list-disc pl-5 space-y-1 text-xs sm:text-sm">
                                  <li>
                                    <strong>Leading Zeros & Alphanumeric Formats:</strong> Roll numbers like <code className="font-mono bg-slate-100 px-1 rounded">001</code> to <code className="font-mono bg-slate-100 px-1 rounded">050</code>, long 10+ digit IDs like <code className="font-mono bg-slate-100 px-1 rounded">8601000001</code>, and prefixed IDs like <code className="font-mono bg-slate-100 px-1 rounded">BCA2026001</code> to <code className="font-mono bg-slate-100 px-1 rounded">BCA2026050</code> are preserved verbatim.
                                  </li>
                                  <li>
                                    <strong>After clicking "Generate & Set Roll List":</strong> The Registered Students table below updates immediately. Always verify the <strong>Registered Students count</strong> (for example, <code className="font-mono">599</code>) before clicking Continue.
                                  </li>
                                </ul>
                                <CommonMistakes
                                  mistakes={[
                                    'Entering an Ending Roll Number smaller than the Starting Roll Number.',
                                    'Mixing different prefixes (e.g., BCA001 to BBA050) in a single range — generate one course and then use "Append to Existing List" for the second course.'
                                  ]}
                                />
                              </div>
                            )}
                          </div>

                          {/* Option 2 */}
                          <div className="border border-slate-200 rounded-lg p-4 space-y-3">
                            <button
                              type="button"
                              onClick={() => togglePanel('opt-upload')}
                              className="w-full flex items-center justify-between gap-2 text-left"
                            >
                              <div className="flex items-center gap-2.5">
                                <FileSpreadsheet className="w-4 h-4 text-blue-600 shrink-0" />
                                <span className="font-display font-bold text-sm text-slate-900">
                                  Option 2: Upload CSV / Excel
                                </span>
                              </div>
                              {expandedPanels['opt-upload'] ? (
                                <ChevronDown className="w-4 h-4 text-slate-400" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-slate-400" />
                              )}
                            </button>

                            {expandedPanels['opt-upload'] && (
                              <div className="pt-2 space-y-3 text-sm text-slate-600 border-t border-slate-100">
                                <p>
                                  <strong>Supported Formats:</strong> <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">.csv</code>, <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">.xlsx</code>, and <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">.xls</code> (up to 10 MB). You can click <strong>Excel Template</strong> or <strong>CSV Template</strong> right inside the tab to download a ready-made sample file.
                                </p>
                                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                                  <table className="w-full text-left border-collapse text-xs">
                                    <thead>
                                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                                        <th className="py-2 px-3 font-semibold">Recommended Column</th>
                                        <th className="py-2 px-3 font-semibold">Requirement</th>
                                        <th className="py-2 px-3 font-semibold">Notes</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                      <tr>
                                        <td className="py-2 px-3 font-mono font-semibold text-slate-900">Roll Number</td>
                                        <td className="py-2 px-3 text-red-700 font-semibold">Mandatory</td>
                                        <td className="py-2 px-3">Rows with an empty Roll Number are skipped automatically.</td>
                                      </tr>
                                      <tr>
                                        <td className="py-2 px-3 font-mono font-semibold text-slate-900">Student Name</td>
                                        <td className="py-2 px-3 text-slate-500">Optional</td>
                                        <td className="py-2 px-3">May be left blank! Processed cleanly as "Name Not Provided".</td>
                                      </tr>
                                      <tr>
                                        <td className="py-2 px-3 font-mono font-semibold text-slate-900">Class</td>
                                        <td className="py-2 px-3 text-slate-500">Optional</td>
                                        <td className="py-2 px-3">Helpful if multiple classes share one hall.</td>
                                      </tr>
                                      <tr>
                                        <td className="py-2 px-3 font-mono font-semibold text-slate-900">Section</td>
                                        <td className="py-2 px-3 text-slate-500">Optional</td>
                                        <td className="py-2 px-3">Used if you select Course / Section Separation seating mode.</td>
                                      </tr>
                                    </tbody>
                                  </table>
                                </div>
                                <StepList
                                  steps={[
                                    'Prepare your Excel or CSV file with a single header row at the top.',
                                    'Include column headings such as Roll Number, Student Name, Class, and Section.',
                                    'Enter your student details (you can leave Student Name empty if names are unavailable).',
                                    'Click the upload box and select your .csv or .xlsx file.',
                                    'Preview the imported data and confirm that the Roll Number dropdown maps to the right column.',
                                    'Check any validation warnings (such as duplicate roll numbers or AI Data Scanner notes).',
                                    'Click "Accept & Import Rows" (or "Append to Current List") to confirm the records.'
                                  ]}
                                />
                                <InfoBanner
                                  icon={Info}
                                  title="Important: Student Names Are Optional"
                                  body="If student names are unavailable, leave the Student Name column completely empty. Exam Planner still accepts every roll number, displays the student as 'Name Not Provided', and includes them in the seating arrangement."
                                />
                                <CommonMistakes
                                  mistakes={[
                                    'Forgetting to click "Accept & Import" after uploading — uploading only opens the preview; you must confirm to add students.',
                                    'Letting Excel convert long roll numbers into scientific notation (like 8.60E+09) before saving as CSV — format the Roll Number column as Text in Excel or use .xlsx.'
                                  ]}
                                />
                              </div>
                            )}
                          </div>

                          {/* Option 3 */}
                          <div className="border border-slate-200 rounded-lg p-4 space-y-3">
                            <button
                              type="button"
                              onClick={() => togglePanel('opt-manual')}
                              className="w-full flex items-center justify-between gap-2 text-left"
                            >
                              <div className="flex items-center gap-2.5">
                                <UserPlus className="w-4 h-4 text-blue-600 shrink-0" />
                                <span className="font-display font-bold text-sm text-slate-900">
                                  Option 3: Manual Entry
                                </span>
                              </div>
                              {expandedPanels['opt-manual'] ? (
                                <ChevronDown className="w-4 h-4 text-slate-400" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-slate-400" />
                              )}
                            </button>

                            {expandedPanels['opt-manual'] && (
                              <div className="pt-2 space-y-3 text-sm text-slate-600 border-t border-slate-100">
                                <p>
                                  Use Manual Entry when adding a small batch of students or adding late-entry candidates to an existing list.
                                </p>
                                <ul className="list-disc pl-5 space-y-1 text-xs sm:text-sm">
                                  <li><strong>Roll Number (Mandatory):</strong> Enter the student's exact examination roll number (e.g. <code className="font-mono bg-slate-100 px-1 rounded">00015</code>).</li>
                                  <li><strong>Student Name (Optional):</strong> Enter the student's name if available, or leave blank.</li>
                                  <li><strong>Class / Course (Optional):</strong> Enter class or programme (e.g. <code className="font-mono bg-slate-100 px-1 rounded">BCA Sem 4</code>).</li>
                                  <li><strong>Section (Optional):</strong> Enter section if needed (e.g. <code className="font-mono bg-slate-100 px-1 rounded">A</code>).</li>
                                </ul>
                                <p className="text-xs sm:text-sm">
                                  Click <strong>"Add Student"</strong> after each student. The Roll Number and Name boxes clear automatically while keeping Class/Section ready so you can add multiple students quickly one by one. When finished, click <strong>Continue</strong> (or <strong>Save Draft</strong>).
                                </p>
                              </div>
                            )}
                          </div>

                          {/* Option 4 */}
                          <div className="border border-slate-200 rounded-lg p-4 space-y-3">
                            <button
                              type="button"
                              onClick={() => togglePanel('opt-paste')}
                              className="w-full flex items-center justify-between gap-2 text-left"
                            >
                              <div className="flex items-center gap-2.5">
                                <ClipboardPaste className="w-4 h-4 text-blue-600 shrink-0" />
                                <span className="font-display font-bold text-sm text-slate-900">
                                  Option 4: Paste Excel Data
                                </span>
                              </div>
                              {expandedPanels['opt-paste'] ? (
                                <ChevronDown className="w-4 h-4 text-slate-400" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-slate-400" />
                              )}
                            </button>

                            {expandedPanels['opt-paste'] && (
                              <div className="pt-2 space-y-3 text-sm text-slate-600 border-t border-slate-100">
                                <p>
                                  Fastest option when your student list is already open in Microsoft Excel or Google Sheets and you don't want to save a separate file.
                                </p>
                                <StepList
                                  steps={[
                                    'Open your Excel or Google Sheets spreadsheet.',
                                    'Select the student cells — be sure to include the top column heading row (e.g., Roll Number, Student Name, Section).',
                                    'Copy the selected cells (Ctrl+C or Cmd+C).',
                                    'Open the "Paste Excel Data" tab inside Exam Planner.',
                                    'Click inside the text box and paste (Ctrl+V or Cmd+V), then click "Parse & Preview Pasted Data".',
                                    'Check the Column Mapping and 5-row preview table.',
                                    'Click "Accept & Import Rows" to confirm the import.'
                                  ]}
                                />
                                <CommonMistakes
                                  mistakes={[
                                    'Copying only the data rows without the column heading row — the importer uses the first row as column headers.'
                                  ]}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      </CollapsibleBlock>

                      {/* STEP 3: CLASSROOM CONFIGURATION */}
                      <CollapsibleBlock
                        id="step3-classrooms"
                        isOpen={Boolean(expandedPanels['step3-classrooms'])}
                        onToggle={() => togglePanel('step3-classrooms')}
                        badge="Step 3 of 4"
                        title="STEP 3: CLASSROOM CONFIGURATION"
                        subtitle="Set up your examination rooms, rows, benches, and any disabled desks."
                      >
                        <div className="space-y-5 text-sm text-slate-600">
                          <div className="space-y-3">
                            <h4 className="font-display font-bold text-slate-900">
                              Mode A: Uniform Classroom Generator
                            </h4>
                            <p>
                              <em>"Automatically creates multiple classrooms with identical row and bench layouts."</em> Choose this whenever all examination halls share the same size and bench layout.
                            </p>
                            <div className="grid sm:grid-cols-3 gap-3 text-xs">
                              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5">
                                <div className="font-semibold text-slate-900">Total Number of Classrooms</div>
                                <p className="text-slate-600 mt-1">How many rooms are available.</p>
                                <div className="font-mono text-blue-700 font-semibold mt-1.5">
                                  Example: 3 → creates Classroom 1, Classroom 2, Classroom 3
                                </div>
                              </div>
                              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5">
                                <div className="font-semibold text-slate-900">Rows in Each Classroom</div>
                                <p className="text-slate-600 mt-1">How many rows of benches are in each room.</p>
                                <div className="font-mono text-blue-700 font-semibold mt-1.5">
                                  Example: 10 rows per classroom
                                </div>
                              </div>
                              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5">
                                <div className="font-semibold text-slate-900">Benches in Each Row</div>
                                <p className="text-slate-600 mt-1">How many benches sit in each row.</p>
                                <div className="font-mono text-blue-700 font-semibold mt-1.5">
                                  Example: 10 benches per row
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Visual Capacity Calculation Card */}
                          <div className="bg-slate-900 text-slate-100 rounded-xl p-5 space-y-4">
                            <div className="flex items-center gap-2 text-xs font-semibold text-blue-300 uppercase tracking-wider">
                              <Calculator className="w-4 h-4" />
                              <span>Visual Capacity Calculation Example</span>
                            </div>
                            <div className="grid sm:grid-cols-3 gap-3 text-center">
                              <div className="bg-slate-800/80 border border-slate-700 rounded-lg p-3">
                                <div className="text-xs text-slate-400">Classrooms</div>
                                <div className="font-mono text-2xl font-bold text-white tabular-nums mt-0.5">3</div>
                              </div>
                              <div className="bg-slate-800/80 border border-slate-700 rounded-lg p-3">
                                <div className="text-xs text-slate-400">Rows per Classroom</div>
                                <div className="font-mono text-2xl font-bold text-white tabular-nums mt-0.5">10</div>
                              </div>
                              <div className="bg-slate-800/80 border border-slate-700 rounded-lg p-3">
                                <div className="text-xs text-slate-400">Benches per Row</div>
                                <div className="font-mono text-2xl font-bold text-white tabular-nums mt-0.5">10</div>
                              </div>
                            </div>
                            <div className="grid sm:grid-cols-2 gap-3 text-xs sm:text-sm font-mono">
                              <div className="bg-slate-800 border border-slate-700 rounded-lg p-3.5">
                                <div className="text-slate-400 font-sans text-xs mb-1">Total Benches Calculation</div>
                                <div className="text-white font-bold tabular-nums">
                                  3 × 10 × 10 = 300 Benches
                                </div>
                              </div>
                              <div className="bg-blue-950/70 border border-blue-700 rounded-lg p-3.5">
                                <div className="text-blue-300 font-sans text-xs mb-1">
                                  If Each Bench Holds 2 Students
                                </div>
                                <div className="text-white font-bold tabular-nums">
                                  300 × 2 = 600 Student Seats
                                </div>
                              </div>
                            </div>
                            <p className="text-xs text-slate-300 leading-relaxed">
                              Important: Click the blue <strong>"Generate 3 Classrooms"</strong> button to apply your numbers. Whenever you change rooms, rows, benches, or seating mode, the Live Capacity Summary Bar at the top updates immediately to show whether your total seats are sufficient.
                            </p>
                          </div>

                          <div className="space-y-2">
                            <h4 className="font-display text-base font-bold text-slate-900">
                              Mode B: Advanced Room Editor & Visual Bench Preview
                            </h4>
                            <p className="leading-relaxed">
                              Switch to <strong>Mode B: Advanced Room Editor</strong> whenever rooms have different sizes or special layouts:
                            </p>
                            <ul className="list-disc pl-5 space-y-1 text-xs sm:text-sm">
                              <li><strong>Custom Classroom Names, Room Numbers & Buildings:</strong> Rename "Classroom 1" to "Main Exam Hall" or "Room 101", and add Building names.</li>
                              <li><strong>Different Sizes per Room:</strong> Set different Row counts and Benches-per-Row values for each room, or click <strong>Add Classroom</strong> / <strong>Duplicate</strong>.</li>
                              <li><strong>Disabled Benches:</strong> In the <strong>Visual Classroom Bench Preview</strong> below the editor, click any bench button (like <code className="font-mono bg-slate-100 px-1 rounded">B4</code>) to mark a broken or reserved desk as disabled. Disabled benches are skipped automatically during allocation.</li>
                              <li><strong>Disable or Delete a Classroom:</strong> Temporarily exclude a room using <strong>Disable / Enable</strong>, or permanently remove it with the trash icon.</li>
                            </ul>
                          </div>

                          <CommonMistakes
                            mistakes={[
                              'Typing numbers into Uniform Classroom Generator and clicking Continue without clicking "Generate N Classrooms" — you must click Generate so the rooms are added.',
                              'Forgetting to account for broken desks — mark them disabled in the Visual Classroom Bench Preview so students are never seated on unusable benches.'
                            ]}
                          />
                        </div>
                      </CollapsibleBlock>

                      {/* STEP 4: SEATING MODE */}
                      <CollapsibleBlock
                        id="step4-mode"
                        isOpen={Boolean(expandedPanels['step4-mode'])}
                        onToggle={() => togglePanel('step4-mode')}
                        badge="Step 4 of 4"
                        title="STEP 4: SEATING MODE & ALLOCATION STRATEGY"
                        subtitle="Choose how many students sit on each bench and review final capacity before generating."
                      >
                        <div className="space-y-4 text-sm text-slate-600">
                          <div className="grid sm:grid-cols-2 gap-4">
                            <div className="border border-slate-200 rounded-lg p-4 space-y-2 bg-slate-50">
                              <div className="font-display font-bold text-slate-900">
                                Mode 1: One Student Per Bench
                              </div>
                              <p className="text-xs leading-relaxed">
                                Each active bench holds 1 student (Seat 1). Seat 2 stays unoccupied. Ideal for high-security board or final university exams.
                              </p>
                              <div className="bg-white border border-slate-200 rounded p-2.5 font-mono text-xs space-y-1">
                                <div>Bench 1 → Roll Number 1</div>
                                <div>Bench 2 → Roll Number 2</div>
                              </div>
                              <div className="text-xs font-mono text-slate-700">
                                Total Capacity = Active Benches × 1
                              </div>
                            </div>

                            <div className="border border-slate-200 rounded-lg p-4 space-y-2 bg-slate-50">
                              <div className="font-display font-bold text-slate-900">
                                Mode 2: Two Students Per Bench
                              </div>
                              <p className="text-xs leading-relaxed">
                                Each active bench holds 2 students (Seat 1 and Seat 2), doubling your total seating capacity.
                              </p>
                              <div className="bg-white border border-slate-200 rounded p-2.5 font-mono text-xs space-y-1">
                                <div>Bench 1: Seat 1 → Roll No. 1 · Seat 2 → Roll No. 2</div>
                                <div>Bench 2: Seat 1 → Roll No. 3 · Seat 2 → Roll No. 4</div>
                              </div>
                              <div className="text-xs font-mono text-slate-700">
                                Total Capacity = Active Benches × 2
                              </div>
                            </div>
                          </div>

                          <p className="leading-relaxed">
                            Select the seating mode that matches your real examination hall arrangement. You can also choose an <strong>Allocation Strategy</strong> (Sequential Allocation by default, Alternate Roll Number Allocation, Course/Section Separation, or Custom Staggered Rules) and <strong>Roll Number Ordering</strong> (Original Input Order, Ascending Natural Roll Number, or Custom Order). Check the <strong>Capacity & Readiness Summary</strong> bar — once Capacity Status shows <strong>Sufficient</strong>, click <strong>Generate & Audit Seating Plan</strong>.
                          </p>
                        </div>
                      </CollapsibleBlock>

                      <div className="flex flex-wrap items-center gap-3 pt-2">
                        <LearnMoreLink
                          label="Start Creating Examination Now"
                          onClick={() => navigate('/create-exam')}
                          isRoute
                        />
                        <LearnMoreLink
                          label="Learn More: Generating & Auditing Plans"
                          onClick={() => jumpToSection('generate-seating-plan')}
                        />
                      </div>
                    </div>
                  )}

                  {/* SECTION 3: GENERATE SEATING PLAN */}
                  {sec.id === 'generate-seating-plan' && (
                    <div className="space-y-6 text-sm text-slate-600 leading-relaxed">
                      <StepList
                        steps={[
                          'Complete Examination Details in Step 1 (Name, Type, Academic Year, Exam Date).',
                          'Add Student Information in Step 2 (Range, CSV/Excel, Manual, or Paste).',
                          'Configure Classrooms in Step 3 (Uniform Generator or Advanced Room Editor).',
                          'Select Seating Mode (1 or 2 students per bench) and Allocation Strategy in Step 4.',
                          'Review the Capacity & Readiness Summary (Total Students vs Available Seats and Unused Seats).',
                          'Click "Generate & Audit Seating Plan" (or "Generate Seating Plan" in Seating Planner).'
                        ]}
                      />

                      <div className="space-y-2">
                        <h4 className="font-display text-base font-bold text-slate-900">
                          What Happens Automatically After You Click Generate
                        </h4>
                        <p>
                          Exam Planner runs its deterministic seating engine and immediately saves the plan to Firebase. In a fraction of a second, the engine:
                        </p>
                        <ul className="list-disc pl-5 space-y-1.5">
                          <li>Takes your exact roll numbers without modifying, rounding, or stripping leading zeros.</li>
                          <li>Assigns each student to a specific <strong>Classroom → Row → Bench → Seat</strong> following your chosen strategy.</li>
                          <li>Skips any disabled classrooms or disabled benches automatically.</li>
                          <li>Marks leftover seats (for example, 1 spare seat when seating 599 students in 600 seats) clearly as <strong>EMPTY</strong>.</li>
                          <li>Runs the 15-point automated audit to confirm 100% of students were seated with zero duplicates.</li>
                          <li>Opens the <strong>Seating Planner</strong> page so you can inspect the audit, search any roll number, and download PDFs.</li>
                        </ul>
                      </div>

                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-3">
                        <h4 className="font-display text-sm font-bold text-slate-900">
                          Practical Example: Sequential Allocation (2 Students per Bench)
                        </h4>
                        <p className="text-xs sm:text-sm">
                          Suppose you have roll numbers <code className="font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200">8601000001</code> to <code className="font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200">8601000599</code> (599 students) and 3 classrooms of 10 rows × 10 benches (600 seats):
                        </p>
                        <div className="grid sm:grid-cols-3 gap-3 text-xs font-mono">
                          <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-1">
                            <div className="font-sans font-semibold text-slate-900">Classroom 1 (200 seats)</div>
                            <div>Row 1 Bench 1 Seat 1 → 8601000001</div>
                            <div>Row 1 Bench 1 Seat 2 → 8601000002</div>
                            <div className="text-slate-400">...up to...</div>
                            <div>Row 10 Bench 10 Seat 2 → 8601000200</div>
                          </div>
                          <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-1">
                            <div className="font-sans font-semibold text-slate-900">Classroom 2 (200 seats)</div>
                            <div>Row 1 Bench 1 Seat 1 → 8601000201</div>
                            <div>Row 1 Bench 1 Seat 2 → 8601000202</div>
                            <div className="text-slate-400">...up to...</div>
                            <div>Row 10 Bench 10 Seat 2 → 8601000400</div>
                          </div>
                          <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-1">
                            <div className="font-sans font-semibold text-slate-900">Classroom 3 (199 used, 1 empty)</div>
                            <div>Row 1 Bench 1 Seat 1 → 8601000401</div>
                            <div className="text-slate-400">...up to...</div>
                            <div>Row 10 Bench 10 Seat 1 → 8601000599</div>
                            <div className="text-amber-700 font-semibold">Row 10 Bench 10 Seat 2 → EMPTY</div>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <LearnMoreLink
                          label="Learn More: Data Validation & AI Audit"
                          onClick={() => jumpToSection('validation-ai-audit')}
                        />
                        <LearnMoreLink
                          label="Open Seating Planner"
                          onClick={() => navigate('/planner')}
                          isRoute
                        />
                      </div>
                    </div>
                  )}

                  {/* SECTION 4: DATA VALIDATION & AI AUDIT */}
                  {sec.id === 'validation-ai-audit' && (
                    <div className="space-y-6 text-sm text-slate-600 leading-relaxed">
                      <p>
                        Every time a seating plan is generated, Exam Planner performs a strict <strong>15-point deterministic audit</strong> in code, and can also run an optional <strong>AI Multi-Agent Review</strong> (enabled in Settings) to explain findings in plain English.
                      </p>

                      {/* 6 Agents Table */}
                      <div className="space-y-2.5">
                        <h4 className="font-display text-base font-bold text-slate-900 flex items-center gap-2">
                          <Bot className="w-4 h-4 text-blue-600" />
                          <span>The Six Validation & Audit Agents</span>
                        </h4>
                        <div className="overflow-x-auto border border-slate-200 rounded-lg">
                          <table className="w-full text-left border-collapse text-xs sm:text-sm">
                            <thead>
                              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                                <th className="py-2.5 px-4 font-semibold">Agent Name</th>
                                <th className="py-2.5 px-4 font-semibold">What It Checks</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-slate-700">
                              <tr>
                                <td className="py-2.5 px-4 font-semibold text-slate-900">1. Data Scanner</td>
                                <td className="py-2.5 px-4">Scans uploaded CSV/Excel spreadsheets automatically for column header mapping, empty rows, and roll number formatting issues.</td>
                              </tr>
                              <tr>
                                <td className="py-2.5 px-4 font-semibold text-slate-900">2. Data Validation Agent</td>
                                <td className="py-2.5 px-4">Verifies student counts, valid non-empty roll numbers, duplicate roll numbers, and sequence gaps.</td>
                              </tr>
                              <tr>
                                <td className="py-2.5 px-4 font-semibold text-slate-900">3. Classroom Capacity Agent</td>
                                <td className="py-2.5 px-4">Confirms enough active classrooms, benches, and seats are available for all students.</td>
                              </tr>
                              <tr>
                                <td className="py-2.5 px-4 font-semibold text-slate-900">4. Seating Audit Agent</td>
                                <td className="py-2.5 px-4">Checks every seat one by one to ensure no student is omitted, no one is seated twice, and no roll number was altered.</td>
                              </tr>
                              <tr>
                                <td className="py-2.5 px-4 font-semibold text-slate-900">5. PDF Quality Checker</td>
                                <td className="py-2.5 px-4">Reviews roll number lengths, missing name counts, and recommends Portrait vs Landscape orientation for clean printing.</td>
                              </tr>
                              <tr>
                                <td className="py-2.5 px-4 font-semibold text-slate-900">6. Orchestrator</td>
                                <td className="py-2.5 px-4">Coordinates Agents 2–5 together when you click "Run AI Agent Review" and gives a clear summary of recommended actions.</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Audit Status Meanings */}
                      <div className="space-y-3">
                        <h4 className="font-display text-base font-bold text-slate-900">
                          Understanding Audit Statuses
                        </h4>
                        <div className="grid sm:grid-cols-3 gap-3">
                          <div className="border border-emerald-200 bg-emerald-50/50 rounded-xl p-4 space-y-1.5">
                            <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-emerald-700">
                              <CheckCircle2 className="w-4 h-4" />
                              VERIFIED
                            </div>
                            <p className="text-xs text-slate-700 leading-relaxed">
                              All applicable critical checks have passed. Every student is seated accurately and official PDF downloads are unlocked.
                            </p>
                          </div>
                          <div className="border border-amber-200 bg-amber-50/50 rounded-xl p-4 space-y-1.5">
                            <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-amber-800">
                              <AlertTriangle className="w-4 h-4" />
                              WARNING
                            </div>
                            <p className="text-xs text-slate-700 leading-relaxed">
                              Informational items needing a quick look (such as missing student names) that do <strong>not</strong> stop seating allocation or lock PDF exports.
                            </p>
                          </div>
                          <div className="border border-red-200 bg-red-50/50 rounded-xl p-4 space-y-1.5">
                            <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-red-700">
                              <AlertTriangle className="w-4 h-4" />
                              CRITICAL ERROR (FAILED)
                            </div>
                            <p className="text-xs text-slate-700 leading-relaxed">
                              A serious issue (like duplicates or insufficient seats) caused the audit status to be <strong>FAILED</strong>. Verified PDF exports remain locked until resolved.
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Specific Rules */}
                      <div className="space-y-3">
                        <h4 className="font-display text-base font-bold text-slate-900">
                          How Specific Data Cases Are Handled
                        </h4>
                        <ul className="list-disc pl-5 space-y-2">
                          <li>
                            <strong>Missing Student Names (Allowed — Warning Only):</strong> Students without names are completely valid. They receive a seat as normal and show as <code className="font-mono bg-slate-100 px-1 rounded">Name Not Provided</code>.
                          </li>
                          <li>
                            <strong>Duplicate Roll Numbers (Critical Error):</strong> Must be reviewed and removed because two candidates should not accidentally share the same roll number.
                          </li>
                          <li>
                            <strong>Missing Roll Numbers:</strong> If you locked an expected continuous range (via Roll Number Range), any gap or count mismatch raises a critical check. For uploaded spreadsheets, sequence gaps appear as an informational warning only.
                          </li>
                          <li>
                            <strong>Invalid Roll Numbers & Leading Zeros:</strong> Empty roll numbers are rejected, and valid roll numbers are stored as exact text strings so leading zeros (e.g., <code className="font-mono bg-slate-100 px-1 rounded">001</code>) and long IDs (e.g., <code className="font-mono bg-slate-100 px-1 rounded">8601000001</code>) are never truncated or rounded.
                          </li>
                          <li>
                            <strong>Why Verified PDF Export Stays Locked on Failure:</strong> To protect institutions from printing inaccurate hall charts with missing students or duplicate seats, official PDF buttons remain disabled whenever any critical audit check fails.
                          </li>
                        </ul>
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <LearnMoreLink
                          label="Manage AI Validation in Settings"
                          onClick={() => navigate('/settings')}
                          isRoute
                        />
                        <LearnMoreLink
                          label="Learn More: Seating Preview & Search"
                          onClick={() => jumpToSection('seating-preview-search')}
                        />
                      </div>
                    </div>
                  )}

                  {/* SECTION 5: SEATING PREVIEW & SEARCH */}
                  {sec.id === 'seating-preview-search' && (
                    <div className="space-y-6 text-sm text-slate-600 leading-relaxed">
                      <div className="space-y-2">
                        <h4 className="font-display text-base font-bold text-slate-900">
                          Viewing Classroom Layouts on Screen
                        </h4>
                        <p>
                          Open <strong>Seating Planner</strong> from the sidebar to inspect your generated seating plan interactively:
                        </p>
                        <ul className="list-disc pl-5 space-y-1.5">
                          <li>
                            <strong>Navigate Between Classrooms:</strong> Use the <em>Filter Classroom</em> dropdown above the preview to view <strong>All Classrooms</strong> or jump to one specific room (showing allocated/total capacity next to each room name).
                          </li>
                          <li>
                            <strong>Switch View Modes:</strong> Toggle between <strong>Classroom Grid</strong> (visual bench cards grouped by Row 1, Row 2, etc.) and <strong>Row Table</strong> (compact spreadsheet view).
                          </li>
                          <li>
                            <strong>Identify Seat 1, Seat 2 & Empty Seats:</strong> Each bench card displays <em>Seat 1</em> (and <em>Seat 2</em> when Two Students Per Bench is active). Unoccupied seats show <code className="font-mono bg-slate-100 px-1 rounded">EMPTY</code>, and excluded desks show <code className="font-mono bg-slate-100 px-1 rounded">DISABLED</code>.
                          </li>
                          <li>
                            <strong>Search by Roll Number or Name:</strong> Type any roll number, student name, classroom, row, or bench into the search box (<code className="font-mono bg-slate-100 px-1 rounded">Search Roll No., Name, Classroom, Row, or Bench...</code>) to instantly see matching seat cards with Classroom, Row, Bench, and Seat number.
                          </li>
                        </ul>
                      </div>

                      {/* Worked Example (Grounded in Active Exam if present) */}
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div>
                            <h4 className="font-display text-sm font-bold text-slate-900">
                              Worked Example: Finding Roll Number 8601000001
                            </h4>
                            <p className="text-xs text-slate-500 mt-0.5">
                              {activeExam && currentAllocation
                                ? `Live lookup from your active examination: "${activeExam.name}"`
                                : 'How the lookup index resolves a roll number from your active generated seating plan'}
                            </p>
                          </div>
                          {activeExam && currentAllocation && (
                            <button
                              type="button"
                              onClick={() => navigate('/planner')}
                              className="text-xs font-medium text-blue-600 hover:underline shrink-0"
                            >
                              Open in Seating Planner →
                            </button>
                          )}
                        </div>

                        <div className="flex flex-col sm:flex-row gap-2">
                          <input
                            type="text"
                            value={demoLookupInput}
                            onChange={(e) => setDemoLookupInput(e.target.value)}
                            placeholder="Try 8601000001 or any roll in active exam"
                            className="flex-1 px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                          {currentAllocation && currentAllocation.lookupIndex[0] && (
                            <button
                              type="button"
                              onClick={() =>
                                setDemoLookupInput(currentAllocation.lookupIndex[0].rollNumber)
                              }
                              className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg whitespace-nowrap"
                            >
                              Use First Roll in Active Plan ({currentAllocation.lookupIndex[0].rollNumber})
                            </button>
                          )}
                        </div>

                        {currentAllocation ? (
                          liveLookupResult ? (
                            <div className="bg-white border border-emerald-200 rounded-lg p-4 text-xs space-y-1.5">
                              <div className="font-semibold text-emerald-700">
                                Live Match Found in "{activeExam?.name}"
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono">
                                <div>
                                  <span className="text-slate-400 font-sans block">Roll Number</span>
                                  <strong className="text-slate-900">{liveLookupResult.rollNumber}</strong>
                                </div>
                                <div>
                                  <span className="text-slate-400 font-sans block">Classroom</span>
                                  <strong className="text-slate-900">{liveLookupResult.classroomName}</strong>
                                </div>
                                <div>
                                  <span className="text-slate-400 font-sans block">Row & Bench</span>
                                  <strong className="text-slate-900">
                                    {liveLookupResult.rowLabel} · {liveLookupResult.benchLabel}
                                  </strong>
                                </div>
                                <div>
                                  <span className="text-slate-400 font-sans block">Seat</span>
                                  <strong className="text-blue-700">Seat {liveLookupResult.seatNumber}</strong>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="bg-white border border-slate-200 rounded-lg p-4 text-xs text-slate-600 space-y-1.5">
                              <p>
                                Roll number <code className="font-mono font-semibold text-slate-900">{demoLookupInput || '8601000001'}</code> is not in the currently loaded examination (<strong>{activeExam?.name}</strong>).
                              </p>
                              <p>
                                When you type <code className="font-mono">8601000001</code> in the Seating Planner search box for an exam that contains it, the app looks up its exact entry in the generated seating plan and returns a card showing: <strong>Classroom Name</strong>, <strong>Row</strong>, <strong>Bench</strong>, and <strong>Seat 1 / Seat 2</strong>.
                              </p>
                            </div>
                          )
                        ) : (
                          <div className="bg-white border border-slate-200 rounded-lg p-4 text-xs text-slate-600 space-y-2">
                            <p>
                              No generated seating plan is currently loaded in your workspace. Once you generate a plan containing <code className="font-mono font-semibold text-slate-900">8601000001</code>, typing <code className="font-mono font-semibold">8601000001</code> into the Seating Planner search bar instantly reads the generated lookup index and displays the exact assigned <strong>Classroom</strong>, <strong>Row</strong>, <strong>Bench</strong>, and <strong>Seat</strong> from that plan.
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <LearnMoreLink
                          label="Open Seating Planner"
                          onClick={() => navigate('/planner')}
                          isRoute
                        />
                        <LearnMoreLink
                          label="Learn More: PDF Reports & Printing"
                          onClick={() => jumpToSection('pdf-reports-printing')}
                        />
                      </div>
                    </div>
                  )}

                  {/* SECTION 6: PDF REPORTS & PRINTING */}
                  {sec.id === 'pdf-reports-printing' && (
                    <div className="space-y-6 text-sm text-slate-600 leading-relaxed">
                      <p>
                        Exam Planner generates clean, black-and-white printer-friendly PDFs and CSV spreadsheets from your verified seating plans.
                      </p>

                      <div className="overflow-x-auto border border-slate-200 rounded-lg">
                        <table className="w-full text-left border-collapse text-xs sm:text-sm">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                              <th className="py-2.5 px-4 font-semibold">Report Option</th>
                              <th className="py-2.5 px-4 font-semibold">In-App Name</th>
                              <th className="py-2.5 px-4 font-semibold">What It Contains</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 text-slate-700">
                            <tr>
                              <td className="py-2.5 px-4 font-semibold text-slate-900">Full Examination Seating Plan</td>
                              <td className="py-2.5 px-4 font-mono text-xs">Format A: Classroom-Wise Seating Plan PDF / Download All Classrooms PDF</td>
                              <td className="py-2.5 px-4">Master multi-page PDF with institution header, exam details, every classroom, row, bench, roll number, audit verification summary, and coordinator signature blocks.</td>
                            </tr>
                            <tr>
                              <td className="py-2.5 px-4 font-semibold text-slate-900">Individual Classroom PDF</td>
                              <td className="py-2.5 px-4 font-mono text-xs">Format B: Individual Classroom Print Sheets / Download Room PDF</td>
                              <td className="py-2.5 px-4">One dedicated printable sheet per classroom (or a single selected room) for notice boards and invigilators, with signature lines.</td>
                            </tr>
                            <tr>
                              <td className="py-2.5 px-4 font-semibold text-slate-900">Student Allocation Report</td>
                              <td className="py-2.5 px-4 font-mono text-xs">Student Allocation & Capacity CSV / Export Full CSV Report</td>
                              <td className="py-2.5 px-4">Spreadsheet showing where every roll number is seated (Classroom, Row, Bench, Seat) plus classroom capacity totals.</td>
                            </tr>
                            <tr>
                              <td className="py-2.5 px-4 font-semibold text-slate-900">Audit Report</td>
                              <td className="py-2.5 px-4 font-mono text-xs">Seating Allocation Audit & Institutional Audit Trail</td>
                              <td className="py-2.5 px-4">Shows the 15-point verification checklist, warnings/critical errors, and summary metrics (included in Seating Planner, History, and Format A PDF).</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      <StepList
                        steps={[
                          'Open "Generated Plans" (to confirm or load a specific version) or go directly to "PDF Reports" or "Seating Planner".',
                          'Choose your page orientation: A4 Portrait (default for 1 student/bench) or A4 Landscape (recommended for 2 students/bench).',
                          'Preview the seating tables on screen before downloading.',
                          'Click "Download All Classrooms PDF" or "Download All Room Sheets" to save the PDF file.',
                          'To print directly from your browser, click "Print" / "Print Current View", or open the downloaded PDF and print it.',
                          'Need just one room? Use the "Individual Classroom PDF" dropdown on PDF Reports (or "Download Room PDF" on any room card in Seating Planner).'
                        ]}
                      />

                      <InfoBanner
                        icon={Printer}
                        title="Verified Exports Require Audit Status: VERIFIED"
                        body="Official PDF download buttons are locked if any critical audit check failed. Fix duplicate roll numbers or insufficient capacity in the Seating Planner, regenerate the plan until Audit Status reads VERIFIED, and the PDF buttons will unlock automatically."
                      />

                      <div className="flex flex-wrap items-center gap-3">
                        <LearnMoreLink
                          label="Open Generated Plans"
                          onClick={() => navigate('/plans')}
                          isRoute
                        />
                        <LearnMoreLink
                          label="Open PDF Reports"
                          onClick={() => navigate('/reports')}
                          isRoute
                        />
                      </div>
                    </div>
                  )}

                  {/* SECTION 7: EXAMINATION HISTORY */}
                  {sec.id === 'examination-history' && (
                    <div className="space-y-6 text-sm text-slate-600 leading-relaxed">
                      <p>
                        All examinations created by your institution are stored in <strong>Examination History</strong> so you can revisit past schedules, reuse layouts, or update records anytime.
                      </p>

                      <div className="grid sm:grid-cols-2 gap-4">
                        <InstructionCard
                          title="Finding & Reopening Past Exams"
                          items={[
                            'Click "Examination History" in the left sidebar.',
                            'Use the status filter bar (All, Verified, Generated, Draft, Archived) or type a name/subject in the Search box.',
                            'Click "Open" on any examination row to load it as the Active Examination and view it in Seating Planner.',
                            'Use "Duplicate" to clone an existing exam setup as a starting template for a new exam.'
                          ]}
                        />
                        <InstructionCard
                          title="Editing, Regenerating & Archiving"
                          items={[
                            'Edit Details: Click the pencil icon on any non-archived exam to update Examination Name, Exam Date, or Subject.',
                            'Update Students or Classrooms: Open the exam first, then visit "Student Data" or "Classroom Setup" in the sidebar to edit and save.',
                            'Regenerate Seating Plan: Open "Seating Planner" and click "Regenerate & Save New Version". Older versions remain accessible in "Generated Plans".',
                            'Download Reports: Once reopened, visit "PDF Reports" to download any PDF or CSV.',
                            'Archive or Delete: Click the Archive icon to hide old exams from active lists, or the Trash icon to permanently delete an exam.'
                          ]}
                        />
                      </div>

                      <InfoBanner
                        icon={AlertTriangle}
                        title="Review Changes Before Regenerating"
                        body="Always double-check updated student lists, classroom rows, and seating mode before clicking 'Regenerate & Save New Version'. Regenerating creates a new plan version and changes the active seat assignments."
                      />

                      <div className="flex flex-wrap items-center gap-3">
                        <LearnMoreLink
                          label="Open Examination History"
                          onClick={() => navigate('/history')}
                          isRoute
                        />
                        <LearnMoreLink
                          label="Learn More: Common Questions"
                          onClick={() => jumpToSection('faq-troubleshooting')}
                        />
                      </div>
                    </div>
                  )}

                  {/* SECTION 8: COMMON QUESTIONS & TROUBLESHOOTING */}
                  {sec.id === 'faq-troubleshooting' && (
                    <div className="space-y-4">
                      <p className="text-sm text-slate-600 leading-relaxed">
                        Click any question below to view the solution and jump to the related guide section.
                      </p>

                      <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden">
                        {matchingFaqs.map((faq) => {
                          const open = Boolean(openFaqIds[faq.id]) || Boolean(normalizedQuery);
                          return (
                            <div key={faq.id} className="bg-white">
                              <button
                                type="button"
                                onClick={() => toggleFaq(faq.id)}
                                className="w-full px-5 py-4 flex items-center justify-between gap-4 text-left hover:bg-slate-50 transition-colors"
                              >
                                <span className="font-display font-semibold text-sm text-slate-900">
                                  Q: {faq.question}
                                </span>
                                {open ? (
                                  <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                                ) : (
                                  <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                                )}
                              </button>
                              {open && (
                                <div className="px-5 pb-4 pt-1 text-sm text-slate-600 leading-relaxed space-y-2">
                                  <p>
                                    <strong className="text-slate-900">A:</strong> {faq.answer}
                                  </p>
                                  {faq.relatedSectionId && (
                                    <button
                                      type="button"
                                      onClick={() => jumpToSection(faq.relatedSectionId!)}
                                      className="text-xs font-medium text-blue-600 hover:underline"
                                    >
                                      Learn More in Guide →
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </article>
              ))}

              {/* Previous / Next Section Navigation (shown in focused section mode) */}
              {!normalizedQuery && (
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
                  <div>
                    {prevSection ? (
                      <button
                        type="button"
                        onClick={() => jumpToSection(prevSection.id)}
                        className="w-full sm:w-auto inline-flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
                      >
                        <ArrowLeft className="w-4 h-4 shrink-0" />
                        <span>Previous: {prevSection.title}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => navigate('/')}
                        className="w-full sm:w-auto inline-flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
                      >
                        <ArrowLeft className="w-4 h-4 shrink-0" />
                        <span>Back to Dashboard</span>
                      </button>
                    )}
                  </div>

                  <div>
                    {nextSection ? (
                      <button
                        type="button"
                        onClick={() => jumpToSection(nextSection.id)}
                        className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-medium text-white bg-[#0F172A] hover:bg-slate-800 rounded-lg transition-colors"
                      >
                        <span>Next: {nextSection.title}</span>
                        <ArrowRight className="w-4 h-4 shrink-0" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => navigate('/create-exam')}
                        className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                      >
                        <span>Start Creating Examination</span>
                        <ArrowRight className="w-4 h-4 shrink-0" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoBanner({
  icon: Icon,
  title,
  body
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
      <Icon className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
      <div className="space-y-1">
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        <p className="text-xs sm:text-sm text-slate-700 leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

function InstructionCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2.5">
      <h5 className="font-display text-sm font-bold text-slate-900">{title}</h5>
      <ol className="space-y-1.5 text-xs sm:text-sm text-slate-600 list-decimal pl-4 leading-relaxed">
        {items.map((item, idx) => (
          <li key={idx}>{item}</li>
        ))}
      </ol>
    </div>
  );
}

function StepList({ steps }: { steps: string[] }) {
  return (
    <ol className="space-y-2">
      {steps.map((step, i) => (
        <li key={i} className="flex items-start gap-3 text-xs sm:text-sm text-slate-700">
          <span className="w-6 h-6 rounded-md bg-slate-900 text-white font-mono text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
            {i + 1}
          </span>
          <span className="leading-relaxed pt-0.5">{step}</span>
        </li>
      ))}
    </ol>
  );
}

function CommonMistakes({ mistakes }: { mistakes: string[] }) {
  return (
    <div className="bg-amber-50/70 border border-amber-200 rounded-lg p-3.5 space-y-1.5">
      <div className="text-xs font-semibold text-amber-900 flex items-center gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        <span>Common Mistakes to Avoid</span>
      </div>
      <ul className="list-disc pl-5 space-y-1 text-xs text-amber-900/90 leading-relaxed">
        {mistakes.map((m, i) => (
          <li key={i}>{m}</li>
        ))}
      </ul>
    </div>
  );
}

function CollapsibleBlock({
  isOpen,
  onToggle,
  badge,
  title,
  subtitle,
  children
}: {
  id: string;
  isOpen: boolean;
  onToggle: () => void;
  badge: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-slate-200 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-5 py-4 bg-slate-50 hover:bg-slate-100/80 transition-colors flex items-center justify-between gap-4 text-left"
      >
        <div className="space-y-0.5 min-w-0">
          <div className="text-[11px] font-semibold text-blue-600 uppercase tracking-wider">
            {badge}
          </div>
          <div className="font-display text-base font-bold text-slate-900">{title}</div>
          <div className="text-xs text-slate-600">{subtitle}</div>
        </div>
        {isOpen ? (
          <ChevronDown className="w-5 h-5 text-slate-500 shrink-0" />
        ) : (
          <ChevronRight className="w-5 h-5 text-slate-500 shrink-0" />
        )}
      </button>
      {isOpen && <div className="p-5 border-t border-slate-200 bg-white">{children}</div>}
    </section>
  );
}

function LearnMoreLink({
  label,
  onClick,
  isRoute = false
}: {
  label: string;
  onClick: () => void;
  isRoute?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
        isRoute
          ? 'bg-slate-900 text-white border-slate-900 hover:bg-slate-800'
          : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
      }`}
    >
      <span>{label}</span>
    </button>
  );
}
