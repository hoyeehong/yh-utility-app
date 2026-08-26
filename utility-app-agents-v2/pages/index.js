/**
 * pages/index.js — Utility Bill Assistant (ADK-powered chatbot UI)
 *
 * Stack:
 *  - Firebase Auth (Google Sign-In)
 *  - Firebase Firestore (bill history + vector embeddings)
 *  - Python ADK backend (bill scanning + calculations)
 *
 * Flow:
 *  1. User signs in with Google
 *  2. Upload 3 images: SP Group bill + electricity meter + water meter
 *  3. ADK extracts readings → confirmation card
 *  4. lastReading auto-fetched from Firestore (manual input on first use)
 *  5. Calculate → review breakdown → save to Firestore
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';
import {
  subscribeToRecords,
  deleteRecord,
  getLastReading,
  saveRecord,
  buildSummaryText,
} from '../lib/history';
import { uploadAllBillPhotos } from '../lib/storage';

// ─── Calculation helpers (mirroring ADK calculator_tools.py) ─────────────────

function calcElectricity(current, last, rate) {
  const usage = current - last;
  return { usage, rate, total: usage * rate };
}

function calcWater(current, last, taxBase) {
  const usage = current - last;
  const mult1 = usage * 1.21;
  const mult2 = usage * 0.92;
  const mult3 = mult1 * 0.5;
  const total = mult1 + mult2 + mult3;
  const taxFinal = taxBase * 0.5;
  return {
    usage, multiplierOne: mult1, multiplierTwo: mult2,
    multiplierThree: mult3, taxBase, taxFinalCost: taxFinal, total
  };
}

function calcCombined(elecTotal, waterTotal, waterTaxFinal) {
  const sub = elecTotal + waterTotal + waterTaxFinal;
  return { subtotal: sub, gstAmount: sub * 0.09, combinedTotal: sub * 1.09 };
}

const fmt = (n, d = 2) => (typeof n === 'number' ? n.toFixed(d) : '—');

// ─── Message bubble components ────────────────────────────────────────────────

function AgentBubble({ children }) {
  return (
    <div className="msg msg-agent">
      <span className="msg-avatar">⚡</span>
      <div className="msg-body">{children}</div>
    </div>
  );
}

function UserBubble({ children }) {
  return (
    <div className="msg msg-user">
      <div className="msg-body">{children}</div>
    </div>
  );
}

function SystemMsg({ children }) {
  return <div className="msg-system">{children}</div>;
}

// ─── Image upload dropzone ────────────────────────────────────────────────────

function ImageDropzone({ label, icon, accept, onFile, file, id }) {
  const inputRef = useRef();
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  };

  const preview = file ? URL.createObjectURL(file) : null;

  return (
    <div
      id={id}
      className={`dropzone ${dragging ? 'dropzone-active' : ''} ${file ? 'dropzone-filled' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && inputRef.current.click()}
      aria-label={`Upload ${label}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept || 'image/*'}
        style={{ display: 'none' }}
        onChange={(e) => onFile(e.target.files[0])}
      />
      {preview ? (
        <img src={preview} alt={label} className="dropzone-preview" />
      ) : (
        <>
          <span className="dropzone-icon">{icon}</span>
          <span className="dropzone-label">{label}</span>
          <span className="dropzone-hint">Tap or drag to upload</span>
        </>
      )}
    </div>
  );
}

// ─── Confirmation card ────────────────────────────────────────────────────────

function ExtractionCard({ data, onConfirm, onEdit, onSetRate, tariffInfo }) {
  const confidence_color = {
    high: '#22c55e', medium: '#f59e0b', low: '#ef4444',
  }[data.confidence] || '#94a3b8';

  const quarterLabel = tariffInfo?.quarter || 'Q3 2026 (Jul - Sep)';
  const tariffRate = tariffInfo?.rate ?? 0.3191;

  return (
    <div className="extraction-card">
      <div className="extraction-card-header">
        <span>Extracted Readings</span>
        <span className="confidence-badge" style={{ color: confidence_color }}>
          ● {data.confidence || '?'} confidence
        </span>
      </div>

      <div className="extraction-grid">
        <div className="extraction-field">
          <label>Billing Month</label>
          <span>{data.billingMonth || '—'}</span>
        </div>
        <div className="extraction-field">
          <label>Electricity Rate</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            <span>${data.electricityRate ? Number(data.electricityRate).toFixed(4) : '—'}/kWh</span>
            {onSetRate && (
              <button
                type="button"
                id="btn-quick-tariff"
                className="btn-tariff-pill"
                onClick={() => onSetRate(tariffRate)}
                title={`Update to official SP Group ${quarterLabel} tariff rate ($${tariffRate.toFixed(4)}/kWh)`}
              >
                ⚡ Use {quarterLabel} Rate (${tariffRate.toFixed(4)})
              </button>
            )}
          </div>
        </div>
        <div className="extraction-field">
          <label>Water Tax Base</label>
          <span>${data.waterTaxBase ? data.waterTaxBase.toFixed(2) : '—'}</span>
        </div>
        <div className="extraction-field">
          <label>⚡ Electricity Reading</label>
          <span>{typeof data.electricityCurrentReading === 'number' ? data.electricityCurrentReading.toFixed(1) : (data.electricityCurrentReading || '—')} kWh</span>
        </div>
        <div className="extraction-field">
          <label>💧 Water Reading</label>
          <span>{typeof data.waterCurrentReading === 'number' ? data.waterCurrentReading.toFixed(3) : (data.waterCurrentReading || '—')} m³</span>
        </div>
      </div>

      {data.notes && (
        <div className="extraction-notes">ℹ️ {data.notes}</div>
      )}

      <div className="extraction-actions">
        <button id="btn-confirm-readings" className="btn-confirm" onClick={onConfirm}>
          ✓ Confirm & Calculate
        </button>
        <button id="btn-edit-readings" className="btn-secondary" onClick={onEdit}>
          ✏️ Edit Manually
        </button>
      </div>
    </div>
  );
}

// ─── Bill summary card ────────────────────────────────────────────────────────

function BillSummaryCard({ elec, water, combined, billingMonth, onSave, saving }) {
  return (
    <div className="bill-summary-card">
      <div className="bill-summary-header">
        <span>Bill Summary — {billingMonth}</span>
      </div>

      <div className="bill-summary-grid">
        <div className="summary-section">
          <h4>⚡ Electricity</h4>
          <div className="summary-row"><span>Usage</span><span>{fmt(elec.usage, 1)} kWh</span></div>
          <div className="summary-row"><span>Rate</span><span>${fmt(elec.rate, 4)}/kWh</span></div>
          <div className="summary-row summary-total"><span>Subtotal</span><span>${fmt(elec.total)}</span></div>
        </div>

        <div className="summary-section">
          <h4>💧 Water</h4>
          <div className="summary-row"><span>Usage</span><span>{fmt(water.usage, 3)} m³</span></div>
          <div className="summary-row"><span>Multiplier 1 (x1.21)</span><span>${fmt(water.multiplierOne)}</span></div>
          <div className="summary-row"><span>Multiplier 2 (x0.92)</span><span>${fmt(water.multiplierTwo)}</span></div>
          <div className="summary-row"><span>Multiplier 3 (${fmt(water.multiplierOne)} x0.5)</span><span>${fmt(water.multiplierThree)}</span></div>
          <div className="summary-row"><span>Water Tax (x0.5)</span><span>${fmt(water.taxFinalCost)}</span></div>
          <div className="summary-row summary-total"><span>Subtotal</span><span>${fmt(water.total + water.taxFinalCost)}</span></div>
        </div>
      </div>

      <div className="summary-grand-total">
        <span>GST (9%)</span>
        <span>${fmt(combined.gstAmount)}</span>
      </div>
      <div className="summary-grand-total summary-grand-highlight">
        <span>Total (incl. GST)</span>
        <span>${fmt(combined.combinedTotal)}</span>
      </div>

      <button
        id="btn-save-bill"
        className="btn-confirm"
        onClick={onSave}
        disabled={saving}
      >
        {saving ? 'Saving…' : '💾 Save to Firestore'}
      </button>
    </div>
  );
}

// ─── First-time last reading form ─────────────────────────────────────────────

function FirstTimeLastReadingForm({ elecVal, waterVal, onElecChange, onWaterChange, onSubmit, error }) {
  return (
    <div className="manual-form">
      <p className="upload-panel-title">🆕 Previous Meter Readings (First Session Setup)</p>
      <div className="manual-grid">
        <div className="manual-field">
          <label>⚡ Electricity Last Reading (kWh)</label>
          <input
            id="elec-last-input"
            type="text"
            inputMode="decimal"
            className="chat-input-field"
            placeholder="e.g. 82258.0"
            value={elecVal}
            onChange={(e) => onElecChange(e.target.value)}
          />
        </div>
        <div className="manual-field">
          <label>💧 Water Last Reading (m³)</label>
          <input
            id="water-last-input"
            type="text"
            inputMode="decimal"
            className="chat-input-field"
            placeholder="e.g. 1025.856"
            value={waterVal}
            onChange={(e) => onWaterChange(e.target.value)}
          />
        </div>
      </div>
      {error && <div className="error-msg">{error}</div>}
      <button
        id="btn-submit-last-reading"
        className="btn-confirm"
        onClick={onSubmit}
        style={{ marginTop: '0.75rem', width: '100%' }}
      >
        ✓ Calculate Bill
      </button>
    </div>
  );
}

// ─── Image Modal Lightbox ───────────────────────────────────────────────────

function ImageModal({ photo, onClose }) {
  if (!photo) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>{photo.title || 'Photo Proof'}</span>
          <button className="btn-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <img src={photo.url} alt={photo.title} className="modal-image" />
        </div>
      </div>
    </div>
  );
}

// ─── History panel ────────────────────────────────────────────────────────────

function HistoryPanel({ records, onDelete, deleteId, onDeleteConfirm, onDeleteCancel, onPreviewPhoto }) {
  if (records.length === 0) {
    return <div className="history-empty">No saved bills yet. Upload your first bill above!</div>;
  }

  return (
    <div className="history-list">
      {records.map((r) => {
        const photos = r.photoUrls || {};
        const hasPhotos = Boolean(photos.electricityMeter || photos.waterMeter || photos.bill);

        return (
          <div key={r.id} className="history-item">
            <div className="history-item-header">
              <span className="history-month">{r.billingMonth || 'Unknown month'}</span>
              <span className="history-date">
                {r.createdAt?.toDate ? r.createdAt.toDate().toLocaleDateString() : '—'}
              </span>
            </div>
            <div className="history-item-amounts">
              <span>⚡ ${fmt(r.electricity?.total)}</span>
              <span>💧 ${fmt((r.water?.total || 0) + (r.water?.taxFinalCost || 0))}</span>
              <span className="history-total">Total ${fmt(r.combinedTotal)}</span>
            </div>

            {/* Photo Proof Badges */}
            {hasPhotos && (
              <div className="history-photos">
                <span className="history-photos-label">📷 Proof:</span>
                {photos.electricityMeter && (
                  <button
                    type="button"
                    className="btn-photo-pill"
                    onClick={() => onPreviewPhoto && onPreviewPhoto({ url: photos.electricityMeter, title: `⚡ Electricity Meter — ${r.billingMonth}` })}
                    title="View Electricity Meter Photo"
                  >
                    ⚡ Meter
                  </button>
                )}
                {photos.waterMeter && (
                  <button
                    type="button"
                    className="btn-photo-pill"
                    onClick={() => onPreviewPhoto && onPreviewPhoto({ url: photos.waterMeter, title: `💧 Water Meter — ${r.billingMonth}` })}
                    title="View Water Meter Photo"
                  >
                    💧 Meter
                  </button>
                )}
                {photos.bill && (
                  <button
                    type="button"
                    className="btn-photo-pill"
                    onClick={() => onPreviewPhoto && onPreviewPhoto({ url: photos.bill, title: `📄 SP Group Bill — ${r.billingMonth}` })}
                    title="View SP Bill Photo"
                  >
                    📄 Bill
                  </button>
                )}
              </div>
            )}

            <div className="history-item-actions">
              {deleteId === r.id ? (
                <>
                  <button id={`btn-confirm-delete-${r.id}`} className="btn-danger-sm" onClick={() => onDeleteConfirm(r.id)}>Confirm delete</button>
                  <button id={`btn-cancel-delete-${r.id}`} className="btn-ghost-sm" onClick={onDeleteCancel}>Cancel</button>
                </>
              ) : (
                <button id={`btn-delete-${r.id}`} className="btn-ghost-sm" onClick={() => onDelete(r.id)}>🗑 Delete</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function HomePage() {
  // Auth
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Chat messages
  const [messages, setMessages] = useState([]);
  const chatEndRef = useRef(null);

  // Image uploads
  const [billFile, setBillFile] = useState(null);
  const [elecFile, setElecFile] = useState(null);
  const [waterFile, setWaterFile] = useState(null);

  // Extraction state
  const [scanning, setScanning] = useState(false);
  const [extracted, setExtracted] = useState(null);  // raw ADK response

  // Reading inputs (populated from extraction or manual)
  const [billingMonth, setBillingMonth] = useState('');
  const [electricityRate, setElectricityRate] = useState('');
  const [electricityCurrentReading, setElecCurrent] = useState('');
  const [electricityLastReading, setElecLast] = useState('');
  const [waterCurrentReading, setWaterCurrent] = useState('');
  const [waterLastReading, setWaterLast] = useState('');
  const [waterTaxBase, setWaterTaxBase] = useState('');

  // Calculation results
  const [calcResult, setCalcResult] = useState(null);  // { elec, water, combined }
  const [step, setStep] = useState('upload'); // upload | confirm | lastReading | calculate | save | done

  // History
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState(null);

  // Error / status
  const [error, setError] = useState(null);

  // ── Auth listener ────────────────────────────────────────────────────────────

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthLoading(false);
    });
    return unsub;
  }, []);

  // ── History subscription (real-time) ─────────────────────────────────────────

  useEffect(() => {
    if (!user) { setHistory([]); return; }
    setHistoryLoading(true);
    const unsub = subscribeToRecords(user.uid, (records) => {
      setHistory(records);
      setHistoryLoading(false);
    });
    return unsub;
  }, [user]);

  // ── Auto-scroll chat ──────────────────────────────────────────────────────────

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Regulated tariff auto-fetch upon landing on the page ──────────────────────

  const [tariffInfo, setTariffInfo] = useState({
    quarter: 'Q3 2026 (Jul - Sep)',
    rate: 0.3191,
  });

  useEffect(() => {
    const fetchLatestTariff = async () => {
      try {
        const res = await fetch('/api/tariff');
        if (res.ok) {
          const data = await res.json();
          if (data && data.rate) {
            setTariffInfo({
              quarter: data.quarter || 'Latest Quarter',
              rate: data.rate,
            });
            // Default rate state if not set yet
            setElectricityRate((prev) => (!prev ? data.rate.toString() : prev));
          }
        }
      } catch (err) {
        console.warn('Could not auto-fetch latest electricity tariff:', err.message);
      }
    };
    fetchLatestTariff();
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────────

  const pushAgent = useCallback((content) => {
    setMessages((m) => [...m, { role: 'agent', content, id: Date.now() }]);
  }, []);

  const pushUser = useCallback((content) => {
    setMessages((m) => [...m, { role: 'user', content, id: Date.now() }]);
  }, []);

  // ── Sign in / out ─────────────────────────────────────────────────────────────

  const handleSignIn = async () => {
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    setMessages([]);
    setStep('upload');
    setExtracted(null);
    setCalcResult(null);
  };

  // ── Greet when user logs in ────────────────────────────────────────────────────

  useEffect(() => {
    if (!user) return;
    setMessages([{
      role: 'agent',
      id: 1,
      content: (
        <>
          <p>👋 Welcome back, <strong>{user.displayName?.split(' ')[0]}</strong>!</p>
          <p>Upload your meter photos (and optionally your SP Group bill) below, and I&apos;ll extract the readings for you automatically.</p>
        </>
      ),
    }]);
    setStep('upload');
    setExtracted(null);
    setCalcResult(null);
  }, [user]);

  // ── Scan images ───────────────────────────────────────────────────────────────

  const handleScanImages = async () => {
    if (!elecFile && !waterFile && !billFile) {
      setError('Please upload at least your meter photos before scanning.');
      return;
    }
    setError(null);
    setScanning(true);
    const uploadedList = [
      billFile ? 'SP Group bill' : null,
      elecFile ? 'electricity meter' : null,
      waterFile ? 'water meter' : null,
    ].filter(Boolean).join(' + ');
    pushUser(`📎 Uploaded: ${uploadedList}`);
    pushAgent('Scanning your images… this takes a few seconds ⏳');

    try {
      const formData = new FormData();
      if (billFile) formData.append('bill_image', billFile);
      if (elecFile) formData.append('elec_image', elecFile);
      if (waterFile) formData.append('water_image', waterFile);
      formData.append('uid', user.uid);
      const idToken = await user.getIdToken();

      const res = await fetch('/api/adk-proxy?action=scan-bill', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
        body: formData,
      });

      let data;
      try {
        data = await res.json();
      } catch {
        data = { error: 'Scan error', detail: 'Could not parse response from server' };
      }

      if (!res.ok) {
        let msg = data?.detail || data?.error || 'Scan failed';
        if (typeof msg === 'string') {
          if (msg.includes('503') || msg.toLowerCase().includes('high demand') || msg.toLowerCase().includes('traffic')) {
            msg = '⏳ The AI model is currently experiencing temporary high traffic. Please wait a few seconds and try clicking "Scan Images" again.';
          } else if (msg.includes('429') || msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('quota')) {
            msg = '⚠️ API rate limit reached. Please wait a moment before trying again.';
          } else if (msg.includes('401') || msg.toLowerCase().includes('auth')) {
            msg = '🔑 API authentication failed. Please check your API key in settings.';
          }
        }
        throw new Error(msg);
      }

      if (data.error) {
        pushAgent(`⚠️ ${data.error}: ${data.reason || data.detail || 'Could not parse readings'}`);
        setScanning(false);
        return;
      }

      const currentMonthDefault = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
      const enrichedData = {
        ...data,
        billingMonth: data.billingMonth || currentMonthDefault,
        electricityRate: data.electricityRate || 0.3191,
        waterTaxBase: data.waterTaxBase || 0.0,
      };

      const elecVal = typeof enrichedData.electricityCurrentReading === 'number'
        ? enrichedData.electricityCurrentReading.toFixed(1)
        : (enrichedData.electricityCurrentReading || '');
      const waterVal = typeof enrichedData.waterCurrentReading === 'number'
        ? enrichedData.waterCurrentReading.toFixed(3)
        : (enrichedData.waterCurrentReading || '');

      setExtracted(enrichedData);
      setBillingMonth(enrichedData.billingMonth || '');
      setElectricityRate(enrichedData.electricityRate?.toString() || '0.3191');
      setElecCurrent(elecVal);
      setWaterCurrent(waterVal);
      setWaterTaxBase(enrichedData.waterTaxBase?.toString() || '0.00');

      const handleQuickRateUpdate = (newRate) => {
        const rateStr = newRate.toString();
        setElectricityRate(rateStr);
        setExtracted((prev) => ({ ...prev, electricityRate: newRate }));
        pushAgent(`⚡ Updated electricity rate to **$${Number(newRate).toFixed(4)}/kWh** (${tariffInfo.quarter} SP Group Regulated Tariff)`);
      };

      setStep('confirm');
      pushAgent(
        <ExtractionCard
          data={enrichedData}
          onConfirm={handleConfirmReadings}
          onEdit={() => setStep('manualEntry')}
          onSetRate={handleQuickRateUpdate}
          tariffInfo={tariffInfo}
        />
      );
    } catch (err) {
      setError(err.message);
      pushAgent(`❌ Scan error: ${err.message}`);
    } finally {
      setScanning(false);
    }
  };

  // ── Confirm extracted readings → fetch lastReading ─────────────────────────

  const handleConfirmReadings = async () => {
    pushUser('✓ Readings confirmed');

    try {
      const { electricityLastReading: elecLast, waterLastReading: waterLast, fromBillingMonth } = await getLastReading(user.uid);

      if (elecLast !== null && waterLast !== null) {
        const eStr = typeof elecLast === 'number' ? elecLast.toFixed(1) : elecLast.toString();
        const wStr = typeof waterLast === 'number' ? waterLast.toFixed(3) : waterLast.toString();
        setElecLast(eStr);
        setWaterLast(wStr);
        setStep('readyToCalculate');
        pushAgent(
          <>
            <p>📂 I retrieved your last readings from <strong>{fromBillingMonth || 'previous month'}</strong>:</p>
            <ul style={{ margin: '0.5rem 0', paddingLeft: '1.2rem' }}>
              <li>⚡ Electricity last reading: <strong>{eStr} kWh</strong></li>
              <li>💧 Water last reading: <strong>{wStr} m³</strong></li>
            </ul>
            <p>Ready to calculate?</p>
            <button id="btn-calculate" className="btn-confirm" onClick={handleCalculate} style={{ marginTop: '0.5rem' }}>
              ✓ Calculate Bill
            </button>
          </>
        );
      } else {
        setStep('firstTimeLastReading');
        pushAgent('🆕 This looks like your first session! Please enter your previous meter readings below:');
      }
    } catch (err) {
      setError('Could not fetch last reading: ' + err.message);
    }
  };

  // ── Calculate ─────────────────────────────────────────────────────────────────

  const handleCalculate = () => {
    setError(null);
    const eCurrent = parseFloat(electricityCurrentReading);
    const eLast = parseFloat(electricityLastReading);
    const eRate = parseFloat(electricityRate);
    const wCurrent = parseFloat(waterCurrentReading);
    const wLast = parseFloat(waterLastReading);
    const wTax = parseFloat(waterTaxBase);

    if ([eCurrent, eLast, eRate, wCurrent, wLast, wTax].some(isNaN)) {
      setError('Some readings are missing or invalid. Please check all values.');
      return;
    }

    const elec = calcElectricity(eCurrent, eLast, eRate);
    const water = calcWater(wCurrent, wLast, wTax);
    const combined = calcCombined(elec.total, water.total, water.taxFinalCost);

    const result = {
      electricity: { ...elec, currentReading: eCurrent, lastReading: eLast },
      water: { ...water, currentReading: wCurrent, lastReading: wLast },
      combined,
      billingMonth,
    };

    setCalcResult(result);
    setStep('save');
    pushUser('✓ Calculate');
    pushAgent(
      <BillSummaryCard
        elec={result.electricity}
        water={result.water}
        combined={result.combined}
        billingMonth={billingMonth}
        onSave={() => handleSaveBill(result)}
        saving={saving}
      />
    );
  };

  // ── Save bill ─────────────────────────────────────────────────────────────────

  const handleSaveBill = async (result) => {
    setSaving(true);
    setError(null);
    try {
      // 1. Upload photo proofs to Cloud Storage (if available)
      let photoUrls = {};
      try {
        photoUrls = await uploadAllBillPhotos(user.uid, result.billingMonth, { billFile, elecFile, waterFile });
      } catch (photoErr) {
        console.warn('Storage photo upload skipped or failed:', photoErr);
      }

      // 2. Save structured record + photo URLs to Firestore
      const record = {
        billingMonth: result.billingMonth,
        electricity: result.electricity,
        water: result.water,
        combinedTotal: result.combined.combinedTotal,
        photoUrls,
      };

      await saveRecord(user.uid, record);

      const attachedCount = Object.keys(photoUrls).length;
      const photoNote = attachedCount > 0 ? ` (with ${attachedCount} photo proof${attachedCount > 1 ? 's' : ''} attached 📷)` : '';

      pushUser('💾 Save bill');
      pushAgent(
        <>
          <p>✅ <strong>Bill saved!</strong> {result.billingMonth} — Total: <strong>${fmt(result.combined.combinedTotal)}</strong>{photoNote}</p>
          <p>Ready for next month? Upload new images anytime.</p>
          <button
            id="btn-start-over"
            className="btn-secondary"
            onClick={handleStartOver}
            style={{ marginTop: '0.5rem' }}
          >
            ↩ Start New Bill
          </button>
        </>
      );
      setStep('done');
    } catch (err) {
      console.error('Firestore saveRecord error:', err);
      let errMsg = err.message || 'Unknown Firestore error';
      if (err.code === 'not-found' || errMsg.includes('NOT_FOUND') || errMsg.includes('not-found')) {
        errMsg = 'Cloud Firestore database is not created yet in Firebase Console. Please visit Firebase Console > Firestore Database > "Create database".';
      } else if (err.code === 'permission-denied' || errMsg.includes('permission-denied') || errMsg.includes('permissions')) {
        errMsg = 'Firestore permission denied. Please check your Firestore Security Rules in Firebase Console.';
      }
      setError(errMsg);
      pushAgent(`❌ Save to Firestore failed: ${errMsg}`);
    } finally {
      setSaving(false);
    }
  };

  // ── Start over ────────────────────────────────────────────────────────────────

  const handleStartOver = () => {
    setBillFile(null);
    setElecFile(null);
    setWaterFile(null);
    setExtracted(null);
    setCalcResult(null);
    setBillingMonth('');
    setElectricityRate('');
    setElecCurrent('');
    setElecLast('');
    setWaterCurrent('');
    setWaterLast('');
    setWaterTaxBase('');
    setError(null);
    setStep('upload');
    setMessages([{
      role: 'agent',
      id: Date.now(),
      content: <p>Ready! Upload your next bill and meter photos below. 👇</p>,
    }]);
  };

  // ── Delete history entry ──────────────────────────────────────────────────────

  const handleDeleteConfirm = async (id) => {
    try {
      await deleteRecord(user.uid, id);
      setDeleteId(null);
    } catch (err) {
      setError('Delete failed: ' + err.message);
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────────

  if (authLoading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <Head>
          <title>Utility Bill Assistant</title>
          <meta name="description" content="AI-powered Singapore utility bill calculator — scan your SP Group bill and get instant totals." />
        </Head>
        <div className="login-screen">
          <div className="login-card">
            <div className="login-logo">⚡💧</div>
            <h1 className="login-title">Utility Bill Assistant</h1>
            <p className="login-subtitle">
              Snap your SP Group bill and meter photos — your AI assistant handles the rest.
            </p>
            <button id="btn-google-signin" className="btn-google" onClick={handleSignIn}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              Continue with Google
            </button>
            {error && <p className="login-error">{error}</p>}
          </div>
        </div>
        <style jsx global>{globalStyles}</style>
      </>
    );
  }

  // ── Authenticated app ─────────────────────────────────────────────────────────

  return (
    <>
      <Head>
        <title>Utility Bill Assistant</title>
        <meta name="description" content="AI-powered Singapore utility bill calculator" />
      </Head>

      <div className="app">

        {/* ── Top bar ──────────────────────────────────────────────────────── */}
        <header className="topbar">
          <div className="topbar-brand">⚡💧 Utility Assistant</div>
          <div className="topbar-user">
            <img src={user.photoURL} alt={user.displayName} className="user-avatar" referrerPolicy="no-referrer" />
            <span className="user-name">{user.displayName?.split(' ')[0]}</span>
            <button id="btn-history-toggle" className="btn-topbar" onClick={() => setShowHistory((s) => !s)}>
              📂 History {history.length > 0 && <span className="badge">{history.length}</span>}
            </button>
            <button id="btn-sign-out" className="btn-topbar btn-signout" onClick={handleSignOut}>Sign out</button>
          </div>
        </header>

        <main className="main-layout">

          {/* ── Chat column ───────────────────────────────────────────────── */}
          <section className="chat-col">
            <div className="chat-thread" role="log" aria-live="polite">
              {messages.map((m) => (
                m.role === 'agent'
                  ? <AgentBubble key={m.id}>{m.content}</AgentBubble>
                  : <UserBubble key={m.id}>{m.content}</UserBubble>
              ))}
              <div ref={chatEndRef} />
            </div>

            {/* ── Upload panel (only shown during upload step) ────────────── */}
            {step === 'upload' && (
              <div className="upload-panel">
                <p className="upload-panel-title">Upload your documents</p>
                <div className="dropzone-grid">
                  <ImageDropzone
                    id="dropzone-bill"
                    label="SP Group Bill (Optional)"
                    icon="📄"
                    file={billFile}
                    onFile={setBillFile}
                  />
                  <ImageDropzone
                    id="dropzone-elec"
                    label="Electricity Meter"
                    icon="⚡"
                    file={elecFile}
                    onFile={setElecFile}
                  />
                  <ImageDropzone
                    id="dropzone-water"
                    label="Water Meter"
                    icon="💧"
                    file={waterFile}
                    onFile={setWaterFile}
                  />
                </div>
                {error && <div className="error-msg">{error}</div>}
                <button
                  id="btn-scan-images"
                  className="btn-confirm btn-scan"
                  onClick={handleScanImages}
                  disabled={scanning || (!elecFile && !waterFile && !billFile)}
                >
                  {scanning ? '⏳ Scanning…' : '🔍 Scan Images'}
                </button>
              </div>
            )}

            {/* ── Manual entry (if user clicks "Edit Manually") ────────────── */}
            {step === 'manualEntry' && (
              <div className="manual-form">
                <p className="upload-panel-title">Enter readings manually</p>
                <div className="manual-grid">
                  <div className="manual-field">
                    <label>Billing Month</label>
                    <input
                      type="text"
                      className="chat-input-field"
                      value={billingMonth}
                      onChange={(e) => setBillingMonth(e.target.value)}
                      placeholder="e.g. August 2026"
                    />
                  </div>

                  <div className="manual-field">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem', flexWrap: 'wrap', gap: '0.4rem' }}>
                      <label style={{ margin: 0 }}>Electricity Rate ($/kWh)</label>
                      <button
                        type="button"
                        id="btn-manual-tariff"
                        className="btn-tariff-pill"
                        onClick={() => setElectricityRate(tariffInfo.rate.toString())}
                        title={`Set to official SP Group ${tariffInfo.quarter} tariff ($${tariffInfo.rate.toFixed(4)}/kWh)`}
                      >
                        ⚡ Use {tariffInfo.quarter} Rate (${tariffInfo.rate.toFixed(4)})
                      </button>
                    </div>
                    <input
                      type="number"
                      step="0.0001"
                      className="chat-input-field"
                      value={electricityRate}
                      onChange={(e) => setElectricityRate(e.target.value)}
                      placeholder="0.3191"
                    />
                  </div>

                  <div className="manual-field">
                    <label>⚡ Electricity Current Reading (kWh)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="chat-input-field"
                      value={electricityCurrentReading}
                      onChange={(e) => setElecCurrent(e.target.value)}
                      placeholder="e.g. 82258.0"
                    />
                  </div>

                  <div className="manual-field">
                    <label>💧 Water Current Reading (m³)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="chat-input-field"
                      value={waterCurrentReading}
                      onChange={(e) => setWaterCurrent(e.target.value)}
                      placeholder="e.g. 1025.856"
                    />
                  </div>

                  <div className="manual-field">
                    <label>Water Tax Base ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      className="chat-input-field"
                      value={waterTaxBase}
                      onChange={(e) => setWaterTaxBase(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                </div>
                {error && <div className="error-msg">{error}</div>}
                <button
                  id="btn-manual-confirm"
                  className="btn-confirm"
                  onClick={handleConfirmReadings}
                >
                  ✓ Confirm & Continue
                </button>
              </div>
            )}

            {/* ── First time last reading entry (live controlled form) ─────── */}
            {step === 'firstTimeLastReading' && (
              <FirstTimeLastReadingForm
                elecVal={electricityLastReading}
                waterVal={waterLastReading}
                onElecChange={setElecLast}
                onWaterChange={setWaterLast}
                onSubmit={handleCalculate}
                error={error}
              />
            )}

            {error && step !== 'upload' && step !== 'manualEntry' && step !== 'firstTimeLastReading' && (
              <div className="error-msg" style={{ margin: '1rem' }}>{error}</div>
            )}
          </section>

          {/* ── History sidebar ─────────────────────────────────────────── */}
          {showHistory && (
            <aside className="history-sidebar">
              <div className="history-sidebar-header">
                <h2>Bill History</h2>
                <button id="btn-history-close" className="btn-ghost-sm" onClick={() => setShowHistory(false)}>✕</button>
              </div>
              {historyLoading ? (
                <div className="loading-spinner" />
              ) : (
                <HistoryPanel
                  records={history}
                  onDelete={(id) => setDeleteId(id)}
                  deleteId={deleteId}
                  onDeleteConfirm={handleDeleteConfirm}
                  onDeleteCancel={() => setDeleteId(null)}
                  onPreviewPhoto={setPreviewPhoto}
                />
              )}
            </aside>
          )}

        </main>
      </div>

      {/* ── Photo Lightbox Modal ────────────────────────────────────── */}
      <ImageModal photo={previewPhoto} onClose={() => setPreviewPhoto(null)} />

      <style jsx global>{globalStyles}</style>
    </>
  );
}

// ─── Global styles ────────────────────────────────────────────────────────────

const globalStyles = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:        #0d1117;
    --bg2:       #161b22;
    --bg3:       #21262d;
    --border:    #30363d;
    --text:      #e6edf3;
    --text2:     #8b949e;
    --blue:      #388bfd;
    --blue-dark: #1f6feb;
    --green:     #3fb950;
    --yellow:    #d29922;
    --red:       #f85149;
    --radius:    12px;
    --shadow:    0 8px 32px rgba(0,0,0,0.4);
    --font:      'Inter', -apple-system, sans-serif;
  }

  html, body { height: 100%; background: var(--bg); color: var(--text); font-family: var(--font); font-size: 15px; line-height: 1.6; }

  /* ── Loading screen ─────────────────────────────────────────────────── */
  .loading-screen { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; gap: 1rem; color: var(--text2); }

  /* ── Login screen ───────────────────────────────────────────────────── */
  .login-screen { display: flex; align-items: center; justify-content: center; min-height: 100vh; background: radial-gradient(ellipse at 50% 0%, #1a2744 0%, var(--bg) 70%); }
  .login-card { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); padding: 3rem 2.5rem; max-width: 420px; width: 90%; text-align: center; box-shadow: var(--shadow); }
  .login-logo { font-size: 3rem; margin-bottom: 1rem; }
  .login-title { font-size: 1.75rem; font-weight: 700; margin-bottom: 0.5rem; background: linear-gradient(135deg, var(--blue), #a5d6ff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .login-subtitle { color: var(--text2); margin-bottom: 2rem; font-size: 0.95rem; line-height: 1.6; }
  .btn-google { display: flex; align-items: center; justify-content: center; gap: 0.75rem; width: 100%; padding: 0.85rem 1.5rem; background: var(--bg3); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 1rem; font-weight: 500; cursor: pointer; transition: all 0.2s; }
  .btn-google:hover { background: var(--border); border-color: var(--blue); transform: translateY(-1px); box-shadow: 0 4px 16px rgba(56,139,253,0.2); }
  .login-error { margin-top: 1rem; color: var(--red); font-size: 0.85rem; }

  /* ── App shell ──────────────────────────────────────────────────────── */
  .app { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }

  /* ── Top bar ────────────────────────────────────────────────────────── */
  .topbar { display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 1.5rem; background: var(--bg2); border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .topbar-brand { font-weight: 700; font-size: 1.1rem; color: var(--text); }
  .topbar-user { display: flex; align-items: center; gap: 0.75rem; }
  .user-avatar { width: 32px; height: 32px; border-radius: 50%; border: 2px solid var(--border); }
  .user-name { font-size: 0.9rem; color: var(--text2); }
  .btn-topbar { background: var(--bg3); border: 1px solid var(--border); color: var(--text); padding: 0.4rem 0.85rem; border-radius: 6px; font-size: 0.85rem; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; gap: 0.4rem; }
  .btn-topbar:hover { border-color: var(--blue); color: var(--blue); }
  .btn-signout:hover { border-color: var(--red); color: var(--red); }
  .badge { background: var(--blue); color: white; border-radius: 10px; padding: 0 6px; font-size: 0.75rem; font-weight: 600; }

  /* ── Main layout ────────────────────────────────────────────────────── */
  .main-layout { display: flex; flex: 1; overflow: hidden; }

  /* ── Chat column ────────────────────────────────────────────────────── */
  .chat-col { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .chat-thread { flex: 1; overflow-y: auto; padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem; scroll-behavior: smooth; }
  .chat-thread::-webkit-scrollbar { width: 6px; }
  .chat-thread::-webkit-scrollbar-track { background: transparent; }
  .chat-thread::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

  /* ── Message bubbles ────────────────────────────────────────────────── */
  .msg { display: flex; gap: 0.75rem; max-width: 85%; }
  .msg-agent { align-self: flex-start; }
  .msg-user { align-self: flex-end; flex-direction: row-reverse; }
  .msg-avatar { width: 36px; height: 36px; background: linear-gradient(135deg, var(--blue), #a5d6ff); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1rem; flex-shrink: 0; }
  .msg-body { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); padding: 0.85rem 1.1rem; font-size: 0.95rem; line-height: 1.6; }
  .msg-user .msg-body { background: var(--blue-dark); border-color: var(--blue); color: white; border-radius: var(--radius); }
  .msg-body p { margin-bottom: 0.4rem; }
  .msg-body p:last-child { margin-bottom: 0; }
  .msg-body ul { padding-left: 1.2rem; margin: 0.4rem 0; }
  .msg-system { align-self: center; font-size: 0.8rem; color: var(--text2); background: var(--bg3); border-radius: 20px; padding: 0.3rem 0.9rem; }

  /* ── Upload panel ───────────────────────────────────────────────────── */
  .upload-panel { padding: 1rem 1.5rem 1.5rem; border-top: 1px solid var(--border); background: var(--bg2); flex-shrink: 0; }
  .upload-panel-title { font-size: 0.85rem; font-weight: 600; color: var(--text2); margin-bottom: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .dropzone-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; margin-bottom: 1rem; }
  .dropzone { border: 2px dashed var(--border); border-radius: var(--radius); padding: 1.2rem 0.75rem; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.4rem; cursor: pointer; transition: all 0.2s; min-height: 110px; }
  .dropzone:hover, .dropzone-active { border-color: var(--blue); background: rgba(56,139,253,0.06); }
  .dropzone-filled { border-style: solid; border-color: var(--green); background: rgba(63,185,80,0.06); }
  .dropzone-icon { font-size: 1.75rem; }
  .dropzone-label { font-size: 0.8rem; font-weight: 600; color: var(--text); text-align: center; }
  .dropzone-hint { font-size: 0.72rem; color: var(--text2); }
  .dropzone-preview { width: 100%; height: 100%; object-fit: cover; border-radius: 8px; max-height: 90px; }

  /* ── Buttons ────────────────────────────────────────────────────────── */
  .btn-confirm { background: linear-gradient(135deg, var(--blue), var(--blue-dark)); color: white; border: none; border-radius: 8px; padding: 0.65rem 1.25rem; font-size: 0.95rem; font-weight: 600; cursor: pointer; transition: all 0.2s; }
  .btn-confirm:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(56,139,253,0.35); }
  .btn-confirm:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-scan { width: 100%; padding: 0.75rem; }
  .btn-secondary { background: var(--bg3); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 0.6rem 1.1rem; font-size: 0.9rem; cursor: pointer; transition: all 0.2s; }
  .btn-secondary:hover { border-color: var(--text2); }
  .btn-ghost-sm { background: transparent; border: 1px solid var(--border); color: var(--text2); border-radius: 6px; padding: 0.3rem 0.65rem; font-size: 0.8rem; cursor: pointer; transition: all 0.2s; }
  .btn-ghost-sm:hover { border-color: var(--text); color: var(--text); }
  .btn-danger-sm { background: transparent; border: 1px solid var(--red); color: var(--red); border-radius: 6px; padding: 0.3rem 0.65rem; font-size: 0.8rem; cursor: pointer; }
  .btn-tariff-pill { background: rgba(56, 139, 253, 0.12); border: 1px solid rgba(56, 139, 253, 0.35); color: var(--blue); font-size: 0.72rem; font-weight: 600; border-radius: 6px; padding: 0.2rem 0.55rem; cursor: pointer; transition: all 0.2s; display: inline-flex; align-items: center; gap: 0.25rem; }
  .btn-tariff-pill:hover { background: var(--blue); color: white; transform: translateY(-1px); box-shadow: 0 2px 8px rgba(56, 139, 253, 0.3); }

  /* ── Extraction card ────────────────────────────────────────────────── */
  .extraction-card { background: var(--bg3); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; min-width: 300px; }
  .extraction-card-header { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1rem; background: var(--bg2); border-bottom: 1px solid var(--border); font-weight: 600; font-size: 0.9rem; }
  .confidence-badge { font-size: 0.78rem; font-weight: 600; }
  .extraction-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; padding: 1rem; }
  .extraction-field { display: flex; flex-direction: column; gap: 0.15rem; }
  .extraction-field label { font-size: 0.72rem; color: var(--text2); text-transform: uppercase; letter-spacing: 0.04em; }
  .extraction-field span { font-size: 0.95rem; font-weight: 600; }
  .extraction-notes { padding: 0.5rem 1rem; font-size: 0.82rem; color: var(--yellow); background: rgba(210,153,34,0.08); border-top: 1px solid var(--border); }
  .extraction-actions { display: flex; gap: 0.75rem; padding: 0.75rem 1rem; border-top: 1px solid var(--border); flex-wrap: wrap; }

  /* ── Bill summary card ──────────────────────────────────────────────── */
  .bill-summary-card { background: var(--bg3); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; min-width: 300px; }
  .bill-summary-header { padding: 0.75rem 1rem; background: var(--bg2); border-bottom: 1px solid var(--border); font-weight: 600; font-size: 0.9rem; }
  .bill-summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
  .summary-section { padding: 1rem; border-right: 1px solid var(--border); }
  .summary-section:last-child { border-right: none; }
  .summary-section h4 { font-size: 0.85rem; color: var(--text2); margin-bottom: 0.65rem; font-weight: 600; }
  .summary-row { display: flex; justify-content: space-between; font-size: 0.85rem; padding: 0.2rem 0; color: var(--text2); }
  .summary-row.summary-total { border-top: 1px solid var(--border); margin-top: 0.4rem; padding-top: 0.4rem; color: var(--text); font-weight: 600; }
  .summary-grand-total { display: flex; justify-content: space-between; padding: 0.5rem 1rem; font-size: 0.9rem; border-top: 1px solid var(--border); color: var(--text2); }
  .summary-grand-highlight { background: rgba(56,139,253,0.08); color: var(--text); font-weight: 700; font-size: 1rem; }
  .bill-summary-card .btn-confirm { margin: 0.75rem 1rem; width: calc(100% - 2rem); display: block; }

  /* ── Manual form ────────────────────────────────────────────────────── */
  .manual-form { padding: 1rem 1.5rem 1.5rem; border-top: 1px solid var(--border); background: var(--bg2); flex-shrink: 0; }
  .manual-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 1rem; }
  .manual-field { display: flex; flex-direction: column; gap: 0.3rem; }
  .manual-field label { font-size: 0.78rem; color: var(--text2); font-weight: 500; }

  /* ── Inline form (inside chat bubble) ──────────────────────────────── */
  .inline-form { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.5rem; }
  .inline-form label { font-size: 0.8rem; color: var(--text2); }

  /* ── Chat input field ────────────────────────────────────────────────── */
  .chat-input-field { background: var(--bg3); border: 1px solid var(--border); color: var(--text); border-radius: 6px; padding: 0.5rem 0.75rem; font-size: 0.9rem; width: 100%; transition: border-color 0.2s; }
  .chat-input-field:focus { outline: none; border-color: var(--blue); }

  /* ── History sidebar ─────────────────────────────────────────────────── */
  .history-sidebar { width: 320px; border-left: 1px solid var(--border); background: var(--bg2); display: flex; flex-direction: column; overflow: hidden; flex-shrink: 0; }
  .history-sidebar-header { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.25rem; border-bottom: 1px solid var(--border); }
  .history-sidebar-header h2 { font-size: 1rem; font-weight: 600; }
  .history-list { overflow-y: auto; flex: 1; padding: 0.75rem; display: flex; flex-direction: column; gap: 0.6rem; }
  .history-empty { color: var(--text2); font-size: 0.85rem; text-align: center; padding: 2rem 1rem; }
  .history-item { background: var(--bg3); border: 1px solid var(--border); border-radius: 10px; padding: 0.85rem 1rem; }
  .history-item-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
  .history-month { font-weight: 600; font-size: 0.9rem; }
  .history-date { font-size: 0.75rem; color: var(--text2); }
  .history-item-amounts { display: flex; gap: 0.5rem; flex-wrap: wrap; font-size: 0.82rem; margin-bottom: 0.5rem; }
  .history-total { font-weight: 700; color: var(--blue); margin-left: auto; }
  .history-photos { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 0.6rem; padding: 0.35rem 0.5rem; background: var(--bg2); border-radius: 6px; }
  .history-photos-label { font-size: 0.72rem; color: var(--text2); font-weight: 600; }
  .btn-photo-pill { background: rgba(56,139,253,0.12); border: 1px solid rgba(56,139,253,0.3); color: var(--blue); border-radius: 4px; padding: 0.15rem 0.45rem; font-size: 0.72rem; cursor: pointer; transition: all 0.2s; }
  .btn-photo-pill:hover { background: var(--blue); color: white; transform: translateY(-1px); }
  .history-item-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }

  /* ── Image Modal Lightbox ───────────────────────────────────────────── */
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(4px); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 1.5rem; }
  .modal-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; max-width: 800px; width: 100%; max-height: 90vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 12px 32px rgba(0,0,0,0.5); }
  .modal-header { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1.25rem; border-bottom: 1px solid var(--border); font-weight: 600; font-size: 0.95rem; }
  .btn-modal-close { background: transparent; border: none; color: var(--text2); font-size: 1.2rem; cursor: pointer; padding: 0.2rem 0.5rem; border-radius: 4px; }
  .btn-modal-close:hover { background: var(--bg3); color: var(--text); }
  .modal-body { padding: 1rem; overflow: auto; display: flex; justify-content: center; align-items: center; background: #000; }
  .modal-image { max-width: 100%; max-height: 75vh; object-fit: contain; border-radius: 6px; }

  /* ── Error / loading ────────────────────────────────────────────────── */
  .error-msg { background: rgba(248,81,73,0.1); border: 1px solid var(--red); color: var(--red); border-radius: 8px; padding: 0.65rem 1rem; font-size: 0.85rem; }
  .loading-spinner { border: 3px solid var(--border); border-top-color: var(--blue); border-radius: 50%; width: 28px; height: 28px; animation: spin 0.8s linear infinite; margin: 1rem auto; }
  @keyframes spin { to { transform: rotate(360deg); } }

  @media (max-width: 640px) {
    .dropzone-grid { grid-template-columns: 1fr; }
    .bill-summary-grid { grid-template-columns: 1fr; }
    .manual-grid { grid-template-columns: 1fr; }
    .history-sidebar { width: 100%; position: absolute; top: 48px; right: 0; bottom: 0; z-index: 10; }
  }
`;
