import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Save, Upload } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { InstitutionType } from '../core/types';
import { updateCoordinatorName, updateInstitutionProfile } from '../firebase/service';

const INSTITUTION_TYPES: InstitutionType[] = [
  'School',
  'College',
  'University',
  'Coaching Institute',
  'Examination Center',
  'Other'
];

export function InstitutionProfilePage() {
  const { firebaseUser, userProfile, institution, refreshProfile } = useAuth();

  const [fullName, setFullName] = useState(userProfile?.fullName ?? '');
  const [name, setName] = useState(institution?.name ?? '');
  const [type, setType] = useState<InstitutionType>(institution?.type ?? 'College');
  const [address, setAddress] = useState(institution?.address ?? '');
  const [city, setCity] = useState(institution?.city ?? '');
  const [stateName, setStateName] = useState(institution?.state ?? '');
  const [pinCode, setPinCode] = useState(institution?.pinCode ?? '');
  const [mobile, setMobile] = useState(institution?.mobile ?? '');
  const [logoDataUrl, setLogoDataUrl] = useState<string | undefined>(institution?.logoDataUrl);

  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (userProfile) setFullName(userProfile.fullName);
    if (institution) {
      setName(institution.name);
      setType(institution.type);
      setAddress(institution.address);
      setCity(institution.city);
      setStateName(institution.state);
      setPinCode(institution.pinCode);
      setMobile(institution.mobile);
      setLogoDataUrl(institution.logoDataUrl);
    }
  }, [userProfile, institution]);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorMsg('Please select a valid image file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 240 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        setLogoDataUrl(canvas.toDataURL('image/png', 0.85));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !institution || !userProfile) return;
    setSaving(true);
    setSavedMsg(null);
    setErrorMsg(null);
    try {
      await Promise.all([
        updateInstitutionProfile(institution.id, firebaseUser.uid, {
          name,
          type,
          address,
          city,
          state: stateName,
          pinCode,
          mobile,
          logoDataUrl
        }),
        updateCoordinatorName(firebaseUser.uid, fullName, userProfile.email)
      ]);
      await refreshProfile();
      setSavedMsg('Institution profile and coordinator details updated.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed updating profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="font-display text-lg font-bold text-slate-900">Institution Profile</h2>
        <p className="text-xs text-slate-500 mt-1 mb-6">
          Details saved here appear on generated seating plan headers and official PDF print sheets.
        </p>

        {savedMsg && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{savedMsg}</span>
          </div>
        )}
        {errorMsg && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Coordinator Name *
              </label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Registered Email
              </label>
              <input
                type="email"
                disabled
                value={userProfile?.email ?? ''}
                className="w-full px-3 py-2 text-sm bg-slate-50 text-slate-500 border border-slate-200 rounded-lg"
              />
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Institution Name *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Institution Type *
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as InstitutionType)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
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
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">City *</label>
              <input
                type="text"
                required
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">State *</label>
              <input
                type="text"
                required
                value={stateName}
                onChange={(e) => setStateName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">PIN Code *</label>
              <input
                type="text"
                required
                value={pinCode}
                onChange={(e) => setPinCode(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Mobile *</label>
              <input
                type="text"
                required
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
              />
            </div>
          </div>

          <div className="flex items-center gap-4 pt-2">
            <label className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              <span>{logoDataUrl ? 'Replace Institution Logo' : 'Upload Institution Logo'}</span>
              <input type="file" accept="image/*" onChange={handleLogoChange} className="hidden" />
            </label>
            {logoDataUrl && (
              <img
                src={logoDataUrl}
                alt="Institution Logo"
                className="w-12 h-12 object-contain border border-slate-200 rounded-lg p-1 bg-white"
              />
            )}
          </div>

          <div className="pt-3 border-t border-slate-200">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Institution Profile
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
