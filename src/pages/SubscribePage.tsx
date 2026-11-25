import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  Info,
  Loader2,
  QrCode,
  RefreshCw,
  ShieldAlert,
  Smartphone,
  Upload,
  X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSubscription } from '../context/SubscriptionContext';
import {
  ALLOWED_EXAMINATION_TYPES,
  buildUpiPaymentUri,
  SUBSCRIPTION_PLAN
} from '../core/subscriptionConstants';
import { makeId } from '../firebase/service';
import {
  formatDateOnly,
  formatPaymentErrorMessage,
  formatTimestamp,
  formatTransactionRefDisplay,
  getPaymentProofUrl,
  submitPaymentRequest,
  UploadTaskController,
  validateProofFileBasic
} from '../firebase/subscriptionService';

type UploadUiState = 'idle' | 'preparing' | 'uploading' | 'paused' | 'saving' | 'success' | 'failed';

interface UploadAttemptState {
  paymentRequestId: string;
  fileFingerprint: string;
  screenshotStoragePath: string | null;
  screenshotFileName: string;
  screenshotMimeType: string;
}

function getFileFingerprint(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function SubscribePage() {
  const { firebaseUser, userProfile, institution, refreshProfile } = useAuth();
  const {
    activeSubscription,
    latestSubscription,
    pendingPaymentRequest,
    paymentRequests,
    subscriptionStatus,
    lockedExaminationType,
    remainingDays,
    cloudflareError,
    refreshSubscription
  } = useSubscription();
  const navigate = useNavigate();

  const upiUri = useMemo(() => buildUpiPaymentUri(), []);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [copiedUpi, setCopiedUpi] = useState(false);

  const [transactionReferenceId, setTransactionReferenceId] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitStage, setSubmitStage] = useState<UploadUiState>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [activeUploadTask, setActiveUploadTask] = useState<UploadTaskController | null>(null);
  const [uploadedAttempt, setUploadedAttempt] = useState<UploadAttemptState | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  const submitLockRef = useRef(false);
  const attemptRef = useRef<UploadAttemptState | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(upiUri, {
      width: 280,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#0F172A',
        light: '#FFFFFF'
      }
    })
      .then((url) => {
        if (active) {
          setQrDataUrl(url);
          setQrError(null);
        }
      })
      .catch((err) => {
        if (active) {
          setQrError(err instanceof Error ? err.message : 'Unable to generate UPI QR code.');
        }
      });
    return () => {
      active = false;
    };
  }, [upiUri]);

  const handleCopyUpi = async () => {
    try {
      await navigator.clipboard.writeText(SUBSCRIPTION_PLAN.upiId);
      setCopiedUpi(true);
      window.setTimeout(() => setCopiedUpi(false), 2500);
    } catch {
      // Fallback ignored if clipboard unavailable
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (submitLockRef.current) return;
    setSubmitError(null);
    setSubmitSuccess(null);
    const file = e.target.files?.[0] ?? null;
    if (!file) {
      setProofFile(null);
      attemptRef.current = null;
      setUploadedAttempt(null);
      return;
    }

    const validation = validateProofFileBasic(file);
    if (!validation.valid) {
      setSubmitError(validation.error || 'Please upload a JPG, JPEG, PNG, or PDF payment proof file.');
      e.target.value = '';
      setProofFile(null);
      attemptRef.current = null;
      setUploadedAttempt(null);
      return;
    }

    const fingerprint = getFileFingerprint(file);
    if (attemptRef.current?.fileFingerprint !== fingerprint) {
      const freshAttempt: UploadAttemptState = {
        paymentRequestId: makeId('payreq'),
        fileFingerprint: fingerprint,
        screenshotStoragePath: null,
        screenshotFileName: file.name,
        screenshotMimeType: validation.mimeType || file.type || 'image/jpeg'
      };
      attemptRef.current = freshAttempt;
      setUploadedAttempt(freshAttempt);
    }

    setProofFile(file);
    setUploadProgress(0);
    setSubmitStage('idle');
  };

  const handleCancelUpload = () => {
    if (!activeUploadTask) return;
    activeUploadTask.cancel();
  };

  const processSubmission = async () => {
    if (submitLockRef.current) return;

    setSubmitError(null);
    setSubmitSuccess(null);

    if (!firebaseUser || !institution) {
      setSubmitError('Authentication and institution profile are required.');
      return;
    }
    if (activeSubscription) {
      setSubmitError('Your institution already has an active subscription.');
      return;
    }
    if (pendingPaymentRequest) {
      setSubmitError(
        'You already have a pending payment verification request awaiting admin approval.'
      );
      return;
    }

    const txn = transactionReferenceId.trim();
    if (txn.length > 120) {
      setSubmitError('UPI Transaction ID must not exceed 120 characters.');
      return;
    }

    const currentAttempt = attemptRef.current;
    const hasUploadedProof = Boolean(currentAttempt?.screenshotStoragePath);

    if (!proofFile && !hasUploadedProof) {
      setSubmitError('Please upload a payment screenshot or PDF receipt of your ₹1 UPI payment.');
      return;
    }

    // Immediate synchronous lock & loading state on first click
    submitLockRef.current = true;
    setSubmitting(true);
    setSubmitStage(hasUploadedProof ? 'saving' : 'preparing');
    setUploadProgress(hasUploadedProof ? 100 : 0);

    try {
      const activeAttempt: UploadAttemptState = currentAttempt ?? {
        paymentRequestId: makeId('payreq'),
        fileFingerprint: proofFile ? getFileFingerprint(proofFile) : 'retained',
        screenshotStoragePath: null,
        screenshotFileName: proofFile?.name || 'proof',
        screenshotMimeType: proofFile?.type || 'image/jpeg'
      };
      attemptRef.current = activeAttempt;
      setUploadedAttempt(activeAttempt);

      await submitPaymentRequest({
        paymentRequestId: activeAttempt.paymentRequestId,
        institutionId: institution.id,
        institutionOwnerId: institution.ownerId,
        institutionName: institution.name,
        userId: firebaseUser.uid,
        userEmail: userProfile?.email || firebaseUser.email || '',
        transactionReferenceId: txn.length > 0 ? txn : null,
        file: proofFile ?? undefined,
        existingScreenshotStoragePath: activeAttempt.screenshotStoragePath ?? undefined,
        existingScreenshotFileName: activeAttempt.screenshotFileName,
        existingScreenshotMimeType: activeAttempt.screenshotMimeType,
        onStageChange: (stage) => {
          setSubmitStage(stage);
        },
        onUploadProgress: (pct) => {
          setUploadProgress(pct);
        },
        onUploadTaskCreated: (task) => {
          setActiveUploadTask(task);
        },
        onUploaded: (uploaded) => {
          const updatedAttempt: UploadAttemptState = {
            paymentRequestId: uploaded.paymentRequestId,
            fileFingerprint: activeAttempt.fileFingerprint,
            screenshotStoragePath: uploaded.screenshotStoragePath,
            screenshotFileName: uploaded.screenshotFileName,
            screenshotMimeType: uploaded.screenshotMimeType
          };
          attemptRef.current = updatedAttempt;
          setUploadedAttempt(updatedAttempt);
        }
      });

      // Reset form only after confirmed successful submission
      attemptRef.current = null;
      setUploadedAttempt(null);
      setActiveUploadTask(null);
      setTransactionReferenceId('');
      setProofFile(null);
      setUploadProgress(100);
      setSubmitStage('success');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setSubmitSuccess('Payment submitted successfully! Your payment proof is awaiting admin verification.');

      await Promise.allSettled([refreshProfile(), refreshSubscription()]);
    } catch (err) {
      setActiveUploadTask(null);
      setSubmitError(formatPaymentErrorMessage(err));
      setSubmitStage('failed');
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await processSubmission();
  };

  const formBlocked = Boolean(activeSubscription || pendingPaymentRequest);
  const canRetrySaveOnly = Boolean(!formBlocked && !submitting && uploadedAttempt?.screenshotStoragePath);
  const canRetryUpload = Boolean(
    !formBlocked && !submitting && submitStage === 'failed' && !uploadedAttempt?.screenshotStoragePath && proofFile
  );

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Page Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Dashboard
          </button>
          <h2 className="font-display text-xl font-bold text-slate-900">
            {SUBSCRIPTION_PLAN.planName} — ₹{SUBSCRIPTION_PLAN.amount} UPI Subscription
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Pay ₹{SUBSCRIPTION_PLAN.amount} via UPI for {SUBSCRIPTION_PLAN.validityDays} days of
            access to one examination type. Verified manually by the administrator.
          </p>
        </div>

        <div className="text-left sm:text-right border-t sm:border-t-0 pt-3 sm:pt-0 border-slate-100 shrink-0">
          <div className="text-xs text-slate-500">Current Plan Status</div>
          <div
            className={`text-sm font-bold mt-0.5 ${
              subscriptionStatus === 'active'
                ? 'text-emerald-700'
                : subscriptionStatus === 'pending'
                ? 'text-amber-700'
                : subscriptionStatus === 'expired' || subscriptionStatus === 'revoked' || subscriptionStatus === 'rejected'
                ? 'text-red-700'
                : 'text-slate-700'
            }`}
          >
            {subscriptionStatus === 'active' && `Active · ${remainingDays} day(s) remaining`}
            {subscriptionStatus === 'pending' && 'Pending Admin Verification'}
            {subscriptionStatus === 'expired' && 'Expired'}
            {subscriptionStatus === 'revoked' && 'Revoked'}
            {subscriptionStatus === 'rejected' && 'Previous Request Rejected'}
            {subscriptionStatus === 'none' && 'Free / Inactive'}
          </div>
        </div>
      </div>

      {/* Cloudflare Backend Connection Warning if Unconfigured */}
      {cloudflareError && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3 text-xs text-amber-950">
          <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Cloudflare Subscription API Notice</div>
            <div className="mt-0.5">{cloudflareError}</div>
          </div>
        </div>
      )}

      {/* Active Subscription Card */}
      {activeSubscription && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
            <div className="text-sm text-emerald-950 space-y-1">
              <div className="font-semibold">
                Your subscription is active. You can now use Exam Planner.
              </div>
              <div className="text-xs text-emerald-800">
                Activated on {formatDateOnly(activeSubscription.activatedAt)} · Expires on{' '}
                <span className="font-mono font-semibold">
                  {formatTimestamp(activeSubscription.expiresAt)}
                </span>{' '}
                · {remainingDays} day(s) left ·{' '}
                {lockedExaminationType
                  ? `Locked Examination Type: ${lockedExaminationType}`
                  : 'Examination Type: Unlocked until first examination creation'}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate('/create-exam')}
            className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg shrink-0"
          >
            Go to Create Examination
          </button>
        </div>
      )}

      {/* Expired Subscription Card */}
      {subscriptionStatus === 'expired' && latestSubscription && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
          <div className="text-sm text-red-950 space-y-1">
            <div className="font-semibold">
              Your subscription has expired. Renew for ₹1 to continue creating examinations.
            </div>
            <p className="text-xs text-red-900">
              Previous subscription expired on {formatTimestamp(latestSubscription.expiresAt)}. Submit
              a new ₹1 UPI payment below to unlock a fresh 15-day subscription and choose a new
              examination type.
            </p>
          </div>
        </div>
      )}

      {/* Pending Verification Banner */}
      {pendingPaymentRequest && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-start gap-3">
          <Clock className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-950 space-y-1">
            <div className="font-semibold">
              Your payment is awaiting verification by the administrator.
            </div>
            <p className="text-xs text-amber-900 leading-relaxed">
              Your ₹{pendingPaymentRequest.amount} UPI payment request (Transaction ID:{' '}
              <span className="font-mono font-semibold">
                {formatTransactionRefDisplay(pendingPaymentRequest.transactionReferenceId)}
              </span>
              ) submitted on {formatTimestamp(pendingPaymentRequest.submittedAt)} is awaiting manual
              admin verification. Duplicate payment requests are disabled until this request is
              reviewed.
            </p>
          </div>
        </div>
      )}

      {/* Post-submission success banner */}
      {submitSuccess && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
          <div className="text-sm text-emerald-900 font-medium">{submitSuccess}</div>
        </div>
      )}

      {/* Two-Column Payment Workflow: QR Code Left, Proof Upload Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Step 1: Original UPI QR Code */}
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-blue-600">
              Step 1 · Scan &amp; Pay ₹1
            </div>
            <h3 className="font-display text-lg font-bold text-slate-900 mt-1">
              Official UPI QR Code
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Scan this live UPI QR code with PhonePe, Google Pay, Paytm, BHIM, or any UPI app to
              pay exactly ₹1.00.
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 flex flex-col items-center justify-center">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt={`UPI QR code for ${SUBSCRIPTION_PLAN.upiId} ₹1`}
                className="w-56 h-56 rounded-lg bg-white p-2 border border-slate-200"
              />
            ) : qrError ? (
              <div className="text-xs text-red-700 text-center p-4">{qrError}</div>
            ) : (
              <div className="w-56 h-56 flex items-center justify-center text-slate-400">
                <QrCode className="w-10 h-10 animate-pulse" />
              </div>
            )}

            <div className="mt-4 text-center space-y-1">
              <div className="text-xs text-slate-500">Payable Amount</div>
              <div className="font-display text-2xl font-bold text-slate-900 tabular-nums">
                ₹{SUBSCRIPTION_PLAN.amount}.00
              </div>
            </div>
          </div>

          {/* UPI ID + Copy + Pay App Intent */}
          <div className="space-y-3">
            <div>
              <div className="text-xs font-medium text-slate-600 mb-1">UPI ID</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 truncate">
                  {SUBSCRIPTION_PLAN.upiId}
                </code>
                <button
                  type="button"
                  onClick={handleCopyUpi}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg shrink-0"
                >
                  {copiedUpi ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy UPI ID
                    </>
                  )}
                </button>
              </div>
            </div>

            <a
              href={upiUri}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#0F172A] hover:bg-slate-800 rounded-lg transition-colors"
            >
              <Smartphone className="w-4 h-4" />
              Pay using UPI App (₹1)
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          {/* Manual Verification Notice */}
          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-start gap-2.5">
            <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <strong className="text-slate-900">Manual Verification Required:</strong> Payments are
              not automatically verified. After completing your ₹1 UPI transfer, upload your
              payment screenshot (and optionally your UPI transaction ID) on the right to request
              activation.
            </div>
          </div>
        </section>

        {/* Step 2: Upload Payment Proof & Submit */}
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-blue-600">
              Step 2 · Upload Payment Proof
            </div>
            <h3 className="font-display text-lg font-bold text-slate-900 mt-1">
              Submit Payment for Verification
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Attach your payment screenshot or PDF receipt. Entering the UPI Transaction ID is
              optional.
            </p>
          </div>

          {submitError && (
            <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 space-y-2.5">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  {submitStage === 'failed' && !canRetrySaveOnly && (
                    <div className="font-semibold text-red-900">
                      Upload failed — Upload interrupted. Your payment request has not been submitted. Retry the upload or choose another file.
                    </div>
                  )}
                  <div>{submitError}</div>
                </div>
              </div>
              {(canRetrySaveOnly || canRetryUpload) && (
                <div className="pl-6 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void processSubmission()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 rounded-md"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    {canRetrySaveOnly
                      ? 'Retry Saving Request (Screenshot Already Uploaded)'
                      : 'Retry Upload'}
                  </button>
                  {canRetryUpload && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-800 bg-white border border-red-300 hover:bg-red-100/50 rounded-md"
                    >
                      Choose Another File
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Institution
                </label>
                <input
                  type="text"
                  disabled
                  value={institution?.name || ''}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Registered Email
                </label>
                <input
                  type="text"
                  disabled
                  value={userProfile?.email || firebaseUser?.email || ''}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-600"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                UPI Transaction ID (Optional)
              </label>
              <input
                type="text"
                maxLength={120}
                disabled={formBlocked || submitting}
                value={transactionReferenceId}
                onChange={(e) => setTransactionReferenceId(e.target.value)}
                placeholder="Optional — e.g. 432910847512 or UPI Reference ID"
                className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-50"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Payment Proof Screenshot or PDF (JPG, JPEG, PNG, PDF · Max 5 MB) *
              </label>
              <label
                className={`flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
                  formBlocked || submitting
                    ? 'border-slate-200 bg-slate-50 cursor-not-allowed opacity-60'
                    : 'border-slate-300 hover:border-blue-500 hover:bg-blue-50/30 cursor-pointer'
                }`}
              >
                <Upload className="w-6 h-6 text-slate-400 mb-2" />
                <span className="text-xs font-medium text-slate-700">
                  {proofFile ? proofFile.name : 'Click to select payment screenshot or PDF receipt'}
                </span>
                <span className="text-[11px] text-slate-400 mt-1">
                  {proofFile
                    ? `${(proofFile.size / 1024).toFixed(1)} KB · ${proofFile.type || 'Detected file'}${
                        uploadedAttempt?.screenshotStoragePath ? ' · Uploaded & ready' : ''
                      }`
                    : 'Accepted formats: JPG, JPEG, PNG, PDF (large screenshots are auto-optimized)'}
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                  disabled={formBlocked || submitting}
                  onChange={handleFileChange}
                  className="sr-only"
                />
              </label>
            </div>

            {submitting && (
              <div
                className="p-3.5 rounded-lg bg-blue-50 border border-blue-200 space-y-2.5"
                role="status"
                aria-live="polite"
              >
                <div className="flex items-center justify-between gap-2 text-xs font-medium text-blue-900">
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                    {submitStage === 'preparing' && 'Preparing file...'}
                    {submitStage === 'uploading' && `Uploading ${uploadProgress}%`}
                    {submitStage === 'saving' && 'Saving payment request...'}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono tabular-nums font-semibold">
                      {uploadProgress}%
                    </span>
                    {activeUploadTask && submitStage === 'uploading' && (
                      <button
                        type="button"
                        onClick={handleCancelUpload}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold bg-white border border-blue-200 text-blue-800 hover:bg-blue-100 rounded"
                      >
                        <X className="w-3 h-3" />
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
                <div className="w-full h-2 bg-blue-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-150 ${
                      submitStage === 'paused' ? 'bg-amber-500' : 'bg-blue-600'
                    }`}
                    style={{ width: `${Math.max(4, uploadProgress)}%` }}
                  />
                </div>
                <div className="text-[11px] text-blue-800">
                  Uploading payment proof — please keep this page open.
                </div>
              </div>
            )}

            {/* Single Examination Type Lock Policy Reminder */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs text-slate-700">
              <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-blue-600" />
                Subscription Rules &amp; Single Examination Type Lock
              </div>
              <p className="leading-relaxed text-slate-600">
                Your ₹1 subscription remains active for <strong>15 days</strong> from the server
                timestamp of admin approval and unlocks <strong>one examination type</strong> of your
                choice ({ALLOWED_EXAMINATION_TYPES.join(', ')}). Creating your first examination
                locks the subscription to that type for the rest of the 15-day period.
              </p>
            </div>

            <div className="pt-1 flex justify-end">
              <button
                type="submit"
                disabled={formBlocked || submitting}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {submitting
                  ? submitStage === 'saving'
                    ? 'Saving Payment Request...'
                    : 'Uploading Payment Proof...'
                  : canRetrySaveOnly
                  ? 'Retry Payment Submission'
                  : canRetryUpload
                  ? 'Retry Upload'
                  : 'Submit Payment for Verification'}
              </button>
            </div>
          </form>
        </section>
      </div>

      {/* Institution Payment Request History */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-display text-base font-bold text-slate-900">
            Your Payment Requests ({paymentRequests.length})
          </h3>
          <span className="text-xs text-slate-500 font-mono">
            Plan: {SUBSCRIPTION_PLAN.planName} · ₹{SUBSCRIPTION_PLAN.amount}
          </span>
        </div>

        {paymentRequests.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No payment verification requests submitted yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <th className="py-3 px-4 font-medium">Transaction / Ref ID</th>
                  <th className="py-3 px-4 font-medium">Amount</th>
                  <th className="py-3 px-4 font-medium">Submitted On</th>
                  <th className="py-3 px-4 font-medium">Proof</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium">Review Notes</th>
                </tr>
              </thead>
              <tbody>
                {paymentRequests.map((req) => (
                  <tr key={req.paymentRequestId} className="border-b border-slate-100 last:border-0">
                    <td className="py-3 px-4 font-mono font-semibold text-slate-900">
                      {formatTransactionRefDisplay(req.transactionReferenceId)}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-800">
                      ₹{req.amount}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                      {formatTimestamp(req.submittedAt)}
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const url = await getPaymentProofUrl(
                              req.screenshotStoragePath,
                              req.paymentRequestId,
                              false
                            );
                            const w = window.open(url, '_blank', 'noopener,noreferrer');
                            if (!w) {
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = req.screenshotFileName || 'payment_proof';
                              a.click();
                            }
                            window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
                          } catch (err) {
                            setSubmitError(formatPaymentErrorMessage(err));
                          }
                        }}
                        className="inline-flex items-center gap-1 text-blue-700 hover:underline font-medium"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        {req.screenshotFileName || 'View Proof'}
                      </button>
                    </td>
                    <td className="py-3 px-4 font-semibold capitalize">
                      <span
                        className={
                          req.status === 'approved'
                            ? 'text-emerald-700'
                            : req.status === 'rejected'
                            ? 'text-red-700'
                            : 'text-amber-700'
                        }
                      >
                        {req.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {req.status === 'approved'
                        ? `Approved on ${formatTimestamp(req.reviewedAt)}`
                        : req.status === 'rejected'
                        ? req.rejectionReason || 'Rejected by administrator'
                        : 'Pending administrator verification'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
