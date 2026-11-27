import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Upload } from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo';
import { PublicFooter } from '../components/PublicFooter';
import { useAuth } from '../context/AuthContext';
import { InstitutionType } from '../core/types';
import { isFirebaseConfigured } from '../firebase/config';
import {
  createInstitutionAndUserProfile,
  loginWithEmail,
  logoutUser,
  registerWithEmailAndInstitution,
  sendPasswordReset,
  updateUserPassword
} from '../firebase/service';

const INSTITUTION_TYPES: InstitutionType[] = [
  'School',
  'College',
  'University',
  'Coaching Institute',
  'Examination Center',
  'Other'
];

async function compressLogoFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please upload a PNG, JPG, or WebP image for the institution logo.');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Logo file must be under 5 MB.');
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 240;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable.'));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png', 0.85));
      };
      img.onerror = () => reject(new Error('Could not decode the selected image.'));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error('Failed reading logo file.'));
    reader.readAsDataURL(file);
  });
}

export function AuthPage() {
  const { authUser, userProfile, isPasswordRecovery, clearPasswordRecovery, refreshProfile } =
    useAuth();
  const isProfileOnboarding = Boolean(authUser && !userProfile && !isPasswordRecovery);

  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // Login / Reset / Recovery fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  // Registration Personal + Institution fields
  const [fullName, setFullName] = useState(
    String(authUser?.displayName || '')
  );
  const [regEmail, setRegEmail] = useState(authUser?.email || '');
  const [regPassword, setRegPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [institutionName, setInstitutionName] = useState('');
  const [institutionType, setInstitutionType] = useState<InstitutionType>('College');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [stateName, setStateName] = useState('');
  const [pinCode, setPinCode] = useState('');
  const [mobile, setMobile] = useState('');
  const [logoDataUrl, setLogoDataUrl] = useState<string | undefined>(undefined);

  const handleAuthError = (err: unknown) => {
    const msg = err instanceof Error ? err.message : 'Authentication error occurred.';
    const lower = msg.toLowerCase();
    if (lower.includes('invalid login credentials')) {
      setErrorMsg('Invalid email address or password.');
      return;
    }
    if (lower.includes('email not confirmed')) {
      setErrorMsg(
        'Please confirm your email address using the verification link sent to your inbox before signing in.'
      );
      return;
    }
    if (lower.includes('user already registered') || lower.includes('already exists')) {
      setErrorMsg('An account with this email already exists. Please sign in.');
      return;
    }
    if (lower.includes('password should be at least')) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }
    setErrorMsg(msg);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);

    if (!email.trim() || !password) {
      setErrorMsg('Enter your email address and password.');
      return;
    }

    setSubmitting(true);
    try {
      await loginWithEmail(email, password);
    } catch (err) {
      handleAuthError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    if (!email.trim()) {
      setErrorMsg('Enter your registered email address.');
      return;
    }
    setSubmitting(true);
    try {
      await sendPasswordReset(email);
      setInfoMsg(`Password reset email sent to ${email.trim()}. Check your inbox.`);
    } catch (err) {
      handleAuthError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompletePasswordRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    if (newPassword.length < 6) {
      setErrorMsg('New password must be at least 6 characters long.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await updateUserPassword(newPassword);
      setNewPassword('');
      setConfirmNewPassword('');
      clearPasswordRecovery();
      await refreshProfile();
      setInfoMsg('Password updated successfully. You are now signed in.');
      setMode('login');
    } catch (err) {
      handleAuthError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);

    const targetName = (
      isProfileOnboarding ? fullName || String(authUser?.displayName || '') : fullName
    ).trim();
    const targetEmail = (isProfileOnboarding ? authUser?.email || regEmail : regEmail).trim();

    if (!targetName || !targetEmail || !institutionName.trim() || !address.trim() || !city.trim() || !stateName.trim() || !pinCode.trim() || !mobile.trim()) {
      setErrorMsg('Please complete all required personal and institution fields.');
      return;
    }

    if (!isProfileOnboarding) {
      if (regPassword.length < 6) {
        setErrorMsg('Password must be at least 6 characters long.');
        return;
      }
      if (regPassword !== confirmPassword) {
        setErrorMsg('Password and Confirm Password do not match.');
        return;
      }
    }

    setSubmitting(true);
    try {
      if (isProfileOnboarding && authUser) {
        await createInstitutionAndUserProfile({
          fullName: targetName,
          email: targetEmail,
          institutionName: institutionName.trim(),
          institutionType,
          address: address.trim(),
          city: city.trim(),
          state: stateName.trim(),
          pinCode: pinCode.trim(),
          mobile: mobile.trim(),
          logoDataUrl
        });
        await refreshProfile();
      } else {
        const res = await registerWithEmailAndInstitution({
          fullName: targetName,
          email: targetEmail,
          password: regPassword,
          institutionName: institutionName.trim(),
          institutionType,
          address: address.trim(),
          city: city.trim(),
          state: stateName.trim(),
          pinCode: pinCode.trim(),
          mobile: mobile.trim(),
          logoDataUrl
        });
        if (res.requiresEmailVerification) {
          setInfoMsg(
            `Account created for ${targetEmail}. Please check your inbox and click the verification link before signing in. Your institution workspace will finish initializing automatically upon first login.`
          );
          setEmail(targetEmail);
          setMode('login');
          return;
        }
        await refreshProfile();
      }
    } catch (err) {
      handleAuthError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    try {
      const dataUrl = await compressLogoFile(file);
      setLogoDataUrl(dataUrl);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Logo upload failed.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <div className="flex-1 grid lg:grid-cols-12">
      {/* Left Institutional Brand Column */}
      <div className="lg:col-span-5 bg-[#0F172A] text-white p-8 sm:p-12 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-3 mb-12">
            <BrandLogo size={38} variant="light" />
            <span className="font-display font-bold text-lg tracking-tight">EXAM PLANNER</span>
          </div>

          <h1 className="font-display text-3xl sm:text-4xl font-bold leading-tight text-balance mb-4">
            Smart Examination Seating. Zero Manual Allocation.
          </h1>
          <p className="text-slate-300 text-sm sm:text-base leading-relaxed max-w-md mb-10">
            Generate deterministic classroom seating plans from roll number ranges or spreadsheets, verify every seat against an automated 15-point audit, and export print-ready room sheets in seconds.
          </p>

          <div className="space-y-4 border-t border-slate-800 pt-8 text-sm text-slate-300">
            <div>
              <div className="font-semibold text-white">Deterministic Seat Engine</div>
              <div className="text-slate-400 text-xs mt-0.5">
                Preserves leading zeros, alphanumeric roll formats, and exact classroom-row-bench capacity constraints.
              </div>
            </div>
            <div>
              <div className="font-semibold text-white">Private Institution Data Space</div>
              <div className="text-slate-400 text-xs mt-0.5">
                Every institution operates in an isolated Firebase Firestore tenant protected by strict Firestore security rules.
              </div>
            </div>
            <div>
              <div className="font-semibold text-white">Print-Ready PDF Reports</div>
              <div className="text-slate-400 text-xs mt-0.5">
                Generates black-and-white friendly Classroom-Wise Seating Plans and individual Room Invigilator Print Sheets.
              </div>
            </div>
          </div>
        </div>

        <div className="pt-8 text-xs text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>EXAM PLANNER · Examination Management Platform</span>
          <span aria-hidden="true">·</span>
          <Link to="/about" className="text-slate-300 hover:text-white hover:underline transition-colors">
            Meet the Founder
          </Link>
        </div>
      </div>

      {/* Right Authentication / Registration Form Column */}
      <div className="lg:col-span-7 flex items-center justify-center p-6 sm:p-10 lg:p-14">
        <div className="w-full max-w-xl bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
          {!isFirebaseConfigured && (
            <div className="mb-6 p-4 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-2">
              <div>
                Firebase environment variables (<code>VITE_FIREBASE_API_KEY</code>, <code>VITE_FIREBASE_PROJECT_ID</code>, etc.) are not configured yet in this environment.
              </div>
              <div>
                <Link
                  to="/diagnostics"
                  className="inline-flex items-center gap-1.5 font-semibold text-blue-700 hover:text-blue-900 underline"
                >
                  Open Production Diagnostics &amp; Setup Guide &rarr;
                </Link>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="mb-5 p-3.5 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2.5 text-sm text-red-800">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <p>{errorMsg}</p>
            </div>
          )}

          {infoMsg && (
            <div className="mb-5 p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 flex items-start gap-2.5 text-sm text-emerald-800">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
              <p>{infoMsg}</p>
            </div>
          )}

          {isPasswordRecovery ? (
            <div>
              <div className="flex items-center gap-2 text-slate-900 mb-1">
                <KeyRound className="w-5 h-5 text-blue-600" />
                <h2 className="font-display text-xl font-bold">Set New Password</h2>
              </div>
              <p className="text-sm text-slate-500 mb-6">
                Enter a new password for {authUser?.email || 'your account'} to complete recovery.
              </p>
              <form onSubmit={handleCompletePasswordRecovery} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    New Password *
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Confirm New Password *
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    placeholder="Repeat new password"
                    className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                    Update Password
                  </button>
                  <button
                    type="button"
                    onClick={() => clearPasswordRecovery()}
                    className="py-2.5 px-4 border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          ) : isProfileOnboarding ? (
            <div>
              <div className="flex items-center justify-between gap-4 mb-6">
                <div>
                  <h2 className="font-display text-xl font-bold text-slate-900">
                    Complete Institution Setup
                  </h2>
                  <p className="text-sm text-slate-500 mt-1">
                    Signed in as {authUser?.email}. Enter your institution details to create your private workspace.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => logoutUser()}
                  className="text-xs font-medium text-slate-500 hover:text-slate-900 underline shrink-0"
                >
                  Switch Account
                </button>
              </div>
              <form onSubmit={handleRegister} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Coordinator Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName || String(authUser?.displayName || '')}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Dr. Ananya Kulkarni"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <InstitutionFields
                  institutionName={institutionName}
                  setInstitutionName={setInstitutionName}
                  institutionType={institutionType}
                  setInstitutionType={setInstitutionType}
                  address={address}
                  setAddress={setAddress}
                  city={city}
                  setCity={setCity}
                  stateName={stateName}
                  setStateName={setStateName}
                  pinCode={pinCode}
                  setPinCode={setPinCode}
                  mobile={mobile}
                  setMobile={setMobile}
                  logoDataUrl={logoDataUrl}
                  onLogoUpload={handleLogoUpload}
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Create Institution Workspace
                </button>
              </form>
            </div>
          ) : (
            <>
              {/* Mode Switcher */}
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg mb-6">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setErrorMsg(null);
                    setInfoMsg(null);
                  }}
                  className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                    mode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Login
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setErrorMsg(null);
                    setInfoMsg(null);
                  }}
                  className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                    mode === 'register' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Create New Account
                </button>
              </div>

              {mode === 'login' && (
                <div>
                  <h2 className="font-display text-xl font-bold text-slate-900 mb-1">
                    Institution Sign In
                  </h2>
                  <p className="text-sm text-slate-500 mb-6">
                    Access your examination records, seating plans, and PDF reports.
                  </p>

                  <form onSubmit={handleLogin} className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Email Address
                      </label>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="coordinator@institution.edu"
                        className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-medium text-slate-700">Password</label>
                        <button
                          type="button"
                          onClick={() => {
                            setMode('forgot');
                            setErrorMsg(null);
                            setInfoMsg(null);
                          }}
                          className="text-xs font-medium text-blue-600 hover:text-blue-700"
                        >
                          Forgot password?
                        </button>
                      </div>
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          required
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Enter your password"
                          className="w-full px-3 py-2.5 pr-10 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1"
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full py-2.5 px-4 bg-[#0F172A] hover:bg-slate-800 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                    >
                      {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                      Login
                    </button>
                  </form>
                </div>
              )}

              {mode === 'forgot' && (
                <div>
                  <div className="flex items-center gap-2 text-slate-900 mb-1">
                    <KeyRound className="w-5 h-5 text-blue-600" />
                    <h2 className="font-display text-xl font-bold">Reset Password</h2>
                  </div>
                  <p className="text-sm text-slate-500 mb-6">
                    Enter your registered email address and Firebase Authentication will send a password reset link.
                  </p>
                  <form onSubmit={handleForgotPassword} className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Registered Email Address
                      </label>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="coordinator@institution.edu"
                        className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="submit"
                        disabled={submitting}
                        className="flex-1 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                      >
                        {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                        Send Reset Email
                      </button>
                      <button
                        type="button"
                        onClick={() => setMode('login')}
                        className="py-2.5 px-4 border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50"
                      >
                        Back to Login
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {mode === 'register' && (
                <div>
                  <h2 className="font-display text-xl font-bold text-slate-900 mb-1">
                    Register Institution Account
                  </h2>
                  <p className="text-sm text-slate-500 mb-5">
                    Create your examination coordinator account and isolated institution workspace.
                  </p>

                  <form onSubmit={handleRegister} className="space-y-5">
                    <div className="space-y-3">
                      <div className="text-xs font-semibold text-slate-900 border-b border-slate-200 pb-1.5">
                        Personal Details
                      </div>
                      <div className="grid sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Full Name *
                          </label>
                          <input
                            type="text"
                            required
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                            placeholder="Dr. Rajesh Verma"
                            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Email Address *
                          </label>
                          <input
                            type="email"
                            required
                            value={regEmail}
                            onChange={(e) => setRegEmail(e.target.value)}
                            placeholder="examcell@college.edu"
                            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Password *
                          </label>
                          <input
                            type="password"
                            required
                            minLength={6}
                            value={regPassword}
                            onChange={(e) => setRegPassword(e.target.value)}
                            placeholder="Minimum 6 characters"
                            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Confirm Password *
                          </label>
                          <input
                            type="password"
                            required
                            minLength={6}
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="Repeat password"
                            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="text-xs font-semibold text-slate-900 border-b border-slate-200 pb-1.5">
                        Institution Details
                      </div>
                      <InstitutionFields
                        institutionName={institutionName}
                        setInstitutionName={setInstitutionName}
                        institutionType={institutionType}
                        setInstitutionType={setInstitutionType}
                        address={address}
                        setAddress={setAddress}
                        city={city}
                        setCity={setCity}
                        stateName={stateName}
                        setStateName={setStateName}
                        pinCode={pinCode}
                        setPinCode={setPinCode}
                        mobile={mobile}
                        setMobile={setMobile}
                        logoDataUrl={logoDataUrl}
                        onLogoUpload={handleLogoUpload}
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                    >
                      {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                      Create Account & Open Dashboard
                    </button>
                  </form>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      </div>
      <PublicFooter />
    </div>
  );
}

function InstitutionFields(props: {
  institutionName: string;
  setInstitutionName: (v: string) => void;
  institutionType: InstitutionType;
  setInstitutionType: (v: InstitutionType) => void;
  address: string;
  setAddress: (v: string) => void;
  city: string;
  setCity: (v: string) => void;
  stateName: string;
  setStateName: (v: string) => void;
  pinCode: string;
  setPinCode: (v: string) => void;
  mobile: string;
  setMobile: (v: string) => void;
  logoDataUrl?: string;
  onLogoUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-slate-700 mb-1">
            School / College / University / Coaching Name *
          </label>
          <input
            type="text"
            required
            value={props.institutionName}
            onChange={(e) => props.setInstitutionName(e.target.value)}
            placeholder="St. Xavier Institute of Technology"
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Institution Type *
          </label>
          <select
            value={props.institutionType}
            onChange={(e) => props.setInstitutionType(e.target.value as InstitutionType)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            {INSTITUTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">
          Complete Address *
        </label>
        <input
          type="text"
          required
          value={props.address}
          onChange={(e) => props.setAddress(e.target.value)}
          placeholder="14 University Road, Academic Enclave"
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">City *</label>
          <input
            type="text"
            required
            value={props.city}
            onChange={(e) => props.setCity(e.target.value)}
            placeholder="Pune"
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">State *</label>
          <input
            type="text"
            required
            value={props.stateName}
            onChange={(e) => props.setStateName(e.target.value)}
            placeholder="Maharashtra"
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">PIN Code *</label>
          <input
            type="text"
            required
            value={props.pinCode}
            onChange={(e) => props.setPinCode(e.target.value)}
            placeholder="411001"
            className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Mobile *</label>
          <input
            type="tel"
            required
            value={props.mobile}
            onChange={(e) => props.setMobile(e.target.value)}
            placeholder="9876543210"
            className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 pt-1">
        <label className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 cursor-pointer">
          <Upload className="w-3.5 h-3.5" />
          <span>{props.logoDataUrl ? 'Change Institution Logo' : 'Upload Optional Logo'}</span>
          <input type="file" accept="image/*" onChange={props.onLogoUpload} className="hidden" />
        </label>
        {props.logoDataUrl && (
          <img
            src={props.logoDataUrl}
            alt="Institution logo preview"
            className="w-10 h-10 object-contain rounded border border-slate-200 bg-white p-0.5"
          />
        )}
      </div>
    </div>
  );
}
