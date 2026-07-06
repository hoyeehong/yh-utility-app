import { useCallback, useEffect, useMemo, useState } from 'react';
import { 
  auth, 
  googleProvider, 
  db, 
  signInWithPopup, 
  signOut 
} from '../lib/firebase';
import { 
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  getDocs, 
  deleteDoc, 
  doc, 
  serverTimestamp 
} from 'firebase/firestore';

function Header({ title, subtitle }) {
  return (
    <div className="header">
      <h1>{title ? title : 'Utility Bill Calculator'}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
  );
}

const formatCurrency = (value) => {
  const num = Number(value);
  if (Number.isNaN(num)) return '0.00';
  return num.toFixed(2);
};

export default function HomePage() {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);

  // Auth and History State
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  // Billing Month / Label State
  const [billingMonth, setBillingMonth] = useState(() => {
    const date = new Date();
    return date.toLocaleString('default', { month: 'long', year: 'numeric' });
  });

  // Inputs
  const [currentMonth, setCurrentMonth] = useState('');
  const [lastMonth, setLastMonth] = useState('');
  const [electricityRate, setElectricityRate] = useState('');

  const [waterCurrentMonth, setWaterCurrentMonth] = useState('');
  const [waterLastMonth, setWaterLastMonth] = useState('');
  const [waterTax, setWaterTax] = useState('');

  // Dynamic Tariff State
  const [tariffInfo, setTariffInfo] = useState(null);
  const [tariffLoading, setTariffLoading] = useState(false);

  // Calculations
  const electricityUsage = useMemo(
    () => Number(currentMonth || 0) - Number(lastMonth || 0),
    [currentMonth, lastMonth]
  );

  const electricityTotal = useMemo(
    () => electricityUsage * Number(electricityRate || 0),
    [electricityUsage, electricityRate]
  );

  const waterUsage = useMemo(
    () => Number(waterCurrentMonth || 0) - Number(waterLastMonth || 0),
    [waterCurrentMonth, waterLastMonth]
  );
  const waterMultiplierOne = useMemo(() => waterUsage * 1.21, [waterUsage]);
  const waterMultiplierTwo = useMemo(() => waterUsage * 0.92, [waterUsage]);
  const waterMultiplierThree = useMemo(
    () => waterMultiplierOne * 0.5,
    [waterMultiplierOne]
  );
  const waterFinalTotal = useMemo(
    () => waterMultiplierOne + waterMultiplierTwo + waterMultiplierThree,
    [waterMultiplierOne, waterMultiplierTwo, waterMultiplierThree]
  );

  const waterTaxFinalCost = useMemo(
    () => Number(waterTax || 0) * 0.5,
    [waterTax]
  );

  const combinedTotal = useMemo(
    () =>
      (electricityTotal + waterFinalTotal + waterTaxFinalCost) * 1.09,
    [electricityTotal, waterFinalTotal, waterTaxFinalCost]
  );

  // Track Firebase Auth Changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
      if (currentUser) {
        fetchHistory(currentUser.uid);
      } else {
        setHistory([]);
      }
    });
    return () => unsubscribe();
  }, []);

  const fetchLatestTariff = useCallback(async (autoFill = false) => {
    setTariffLoading(true);
    try {
      const res = await fetch('/api/tariff');
      if (res.ok) {
        const data = await res.json();
        setTariffInfo(data);
        setElectricityRate((prev) => (!autoFill || !prev ? data.rate.toString() : prev));
      }
    } catch (err) {
      console.error('Failed to fetch tariff:', err);
    } finally {
      setTariffLoading(false);
    }
  }, []);

  // Fetch latest quarterly Singapore electricity tariff on mount
  useEffect(() => {
    fetchLatestTariff(true);
  }, [fetchLatestTariff]);

  const fetchHistory = async (userId) => {
    setHistoryLoading(true);
    try {
      const q = query(
        collection(db, 'calculations'),
        where('userId', '==', userId),
        orderBy('createdAt', 'desc')
      );
      const querySnapshot = await getDocs(q);
      const records = [];
      querySnapshot.forEach((docSnap) => {
        records.push({ id: docSnap.id, ...docSnap.data() });
      });
      setHistory(records);
    } catch (err) {
      console.error('Error fetching history:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleSignIn = async () => {
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setError(err.message || 'Failed to sign in with Google');
    }
  };

  const handleSignOut = async () => {
    setError(null);
    try {
      await signOut(auth);
    } catch (err) {
      setError(err.message || 'Failed to sign out');
    }
  };

  const deleteHistoryEntry = async (id) => {
    try {
      await deleteDoc(doc(db, 'calculations', id));
      setHistory((prev) => prev.filter((item) => item.id !== id));
      setDeleteConfirmId(null);
    } catch (err) {
      setError('Failed to delete the record: ' + err.message);
    }
  };

  const loadHistoryEntry = (item) => {
    setBillingMonth(item.billingMonth || '');
    setCurrentMonth(item.electricity?.currentReading?.toString() || '');
    setLastMonth(item.electricity?.lastReading?.toString() || '');
    setElectricityRate(item.electricity?.rate?.toString() || '');
    setWaterCurrentMonth(item.water?.currentReading?.toString() || '');
    setWaterLastMonth(item.water?.lastReading?.toString() || '');
    setWaterTax(item.water?.taxBase?.toString() || '');
    setStatus('idle');
    setError(null);
  };

  const handleInputChange = (setter) => (e) => {
    setter(e.target.value);
    setStatus('idle');
    setError(null);
  };

  async function handleSubmit(event) {
    event.preventDefault();
    if (!user) {
      setError('Please sign in with Google at the top of the page to save calculations.');
      return;
    }

    setStatus('submitting');
    setError(null);
    try {
      const calculationData = {
        userId: user.uid,
        billingMonth,
        createdAt: serverTimestamp(),
        electricity: {
          currentReading: Number(currentMonth || 0),
          lastReading: Number(lastMonth || 0),
          usage: electricityUsage,
          rate: Number(electricityRate || 0),
          total: electricityTotal
        },
        water: {
          currentReading: Number(waterCurrentMonth || 0),
          lastReading: Number(waterLastMonth || 0),
          usage: waterUsage,
          multiplierOne: waterMultiplierOne,
          multiplierTwo: waterMultiplierTwo,
          multiplierThree: waterMultiplierThree,
          taxBase: Number(waterTax || 0),
          taxFinalCost: waterTaxFinalCost,
          total: waterFinalTotal
        },
        combinedTotal: combinedTotal
      };

      const docRef = await addDoc(collection(db, 'calculations'), calculationData);
      
      // Optimistically prepend to history
      setHistory((prev) => [
        { 
          id: docRef.id, 
          ...calculationData,
          createdAt: { seconds: Math.floor(Date.now() / 1000) } 
        },
        ...prev
      ]);

      setStatus('success');
    } catch (err) {
      setStatus('idle');
      setError(err.message || 'Something went wrong');
    }
  }

  const inputProps = {
    type: 'number',
    step: '0.0001',
    inputMode: 'decimal',
    min: '0',
    className: 'input-field',
  };

  return (
    <div className="container">
      <style dangerouslySetInnerHTML={{ __html: `
        body {
          margin: 0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          background-color: #f8fafc;
          color: #0f172a;
        }
        .container {
          max-width: 1000px;
          margin: 0 auto;
          padding: 2.5rem 1.5rem;
        }
        .header {
          margin-bottom: 2rem;
          text-align: center;
        }
        .header h1 {
          font-size: 2.25rem;
          font-weight: 800;
          letter-spacing: -0.025em;
          color: #0f172a;
          margin-bottom: 0.5rem;
        }
        .header p {
          color: #475569;
          font-size: 1rem;
          margin: 0;
        }
        
        /* Auth Styles */
        .user-bar {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 1rem 1.5rem;
          margin-bottom: 2rem;
          box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05);
        }
        .user-info {
          display: flex;
          align-items: center;
          gap: 1rem;
          flex-wrap: wrap;
        }
        .avatar {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          border: 2px solid #e2e8f0;
          object-fit: cover;
        }
        .welcome-text {
          display: block;
          font-size: 0.75rem;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .user-name {
          font-size: 0.95rem;
          color: #0f172a;
        }
        .login-prompt {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 1rem;
          font-size: 0.9rem;
          color: #475569;
        }
        .btn-signin {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          background-color: #ffffff;
          color: #374151;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          padding: 0.5rem 1rem;
          font-size: 0.875rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
        }
        .btn-signin:hover {
          background-color: #f9fafb;
          border-color: #c5c7c9;
        }
        .btn-signout {
          background-color: transparent;
          color: #ef4444;
          border: 1px solid #fca5a5;
          border-radius: 6px;
          padding: 0.4rem 0.8rem;
          font-size: 0.825rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          margin-left: auto;
        }
        .btn-signout:hover {
          background-color: #fef2f2;
          border-color: #f87171;
        }
        .google-icon {
          flex-shrink: 0;
        }

        .grid-layout {
          display: grid;
          grid-template-columns: 1fr;
          gap: 2rem;
        }
        @media (min-width: 768px) {
          .grid-layout {
            grid-template-columns: 1fr 1fr;
          }
        }
        .card {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 1.75rem;
          box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px -1px rgba(0, 0, 0, 0.05);
        }
        .card-title {
          font-size: 1.25rem;
          font-weight: 700;
          color: #0f172a;
          margin-top: 0;
          margin-bottom: 1.5rem;
          border-bottom: 1px solid #e2e8f0;
          padding-bottom: 0.75rem;
        }
        .form-group {
          margin-bottom: 1.25rem;
        }
        .form-group label {
          display: block;
          font-size: 0.875rem;
          font-weight: 600;
          color: #334155;
          margin-bottom: 0.5rem;
        }
        .input-field {
          width: 100%;
          padding: 0.75rem;
          font-size: 1rem;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          background-color: #ffffff;
          color: #0f172a;
          transition: all 0.2s;
          box-sizing: border-box;
        }
        .input-field:focus {
          outline: none;
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
        }
        .summary-section {
          margin-top: 1.5rem;
          padding-top: 1rem;
          border-top: 1px solid #e2e8f0;
        }
        .summary-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.5rem 0;
          font-size: 0.925rem;
          color: #475569;
        }
        .summary-row strong {
          color: #1e293b;
        }
        .summary-row.total {
          border-top: 1px dashed #e2e8f0;
          margin-top: 0.5rem;
          padding-top: 0.75rem;
          font-size: 1.05rem;
          font-weight: 700;
          color: #0f172a;
        }
        .summary-row.grand-total {
          border-top: 2px solid #3b82f6;
          margin-top: 1.5rem;
          padding-top: 1rem;
          font-size: 1.35rem;
          font-weight: 800;
          color: #1e3a8a;
        }
        .btn-save {
          width: 100%;
          background-color: #2563eb;
          color: #ffffff;
          border: none;
          border-radius: 8px;
          padding: 0.875rem;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          margin-top: 1.25rem;
        }
        .btn-save:hover:not(:disabled) {
          background-color: #1d4ed8;
        }
        .btn-save:disabled {
          background-color: #93c5fd;
          cursor: not-allowed;
        }
        .status-msg {
          padding: 0.75rem;
          border-radius: 6px;
          margin-top: 1rem;
          font-size: 0.875rem;
          font-weight: 500;
        }
        .status-success {
          background-color: #ecfdf5;
          color: #065f46;
          border: 1px solid #a7f3d0;
        }
        .status-error {
          background-color: #fef2f2;
          color: #991b1b;
          border: 1px solid #fca5a5;
        }

        /* History Styles */
        .history-list {
          display: grid;
          grid-template-columns: 1fr;
          gap: 1rem;
          margin-top: 1rem;
        }
        @media (min-width: 640px) {
          .history-list {
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          }
        }
        .history-item {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .history-item:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
          border-color: #cbd5e1;
        }
        .history-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid #e2e8f0;
          padding-bottom: 0.5rem;
        }
        .history-month {
          font-weight: 700;
          font-size: 0.95rem;
          color: #1e3a8a;
        }
        .history-date {
          font-size: 0.75rem;
          color: #64748b;
        }
        .history-details {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          font-size: 0.85rem;
          color: #475569;
        }
        .history-detail-col {
          display: flex;
          justify-content: space-between;
        }
        .history-detail-col strong {
          color: #0f172a;
        }
        .history-detail-col strong.text-blue {
          color: #2563eb;
          font-weight: 700;
        }
        .history-actions {
          display: flex;
          gap: 0.5rem;
          margin-top: 0.5rem;
          border-top: 1px solid #e2e8f0;
          padding-top: 0.75rem;
        }
        .btn-action-load {
          flex: 1;
          background-color: #eff6ff;
          color: #1d4ed8;
          border: 1px solid #bfdbfe;
          border-radius: 6px;
          padding: 0.4rem;
          font-size: 0.8rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          text-align: center;
        }
        .btn-action-load:hover {
          background-color: #dbeafe;
        }
        .btn-action-delete {
          background-color: transparent;
          color: #dc2626;
          border: 1px solid #fca5a5;
          border-radius: 6px;
          padding: 0.4rem 0.6rem;
          font-size: 0.8rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }
        .btn-action-delete:hover {
          background-color: #fef2f2;
        }
        .btn-action-confirm-delete {
          background-color: #dc2626;
          color: #ffffff;
          border: 1px solid #dc2626;
          border-radius: 6px;
          padding: 0.4rem 0.6rem;
          font-size: 0.8rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }
        .btn-action-confirm-delete:hover {
          background-color: #b91c1c;
        }
        .btn-action-cancel-delete {
          background-color: transparent;
          color: #64748b;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          padding: 0.4rem 0.6rem;
          font-size: 0.8rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }
        .btn-action-cancel-delete:hover {
          background-color: #f1f5f9;
        }
        .loading-spinner, .empty-history {
          text-align: center;
          padding: 2rem;
          color: #64748b;
          font-size: 0.9rem;
        }
        .btn-tariff {
          background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
          color: #1e293b;
          border: none;
          border-radius: 6px;
          padding: 0.35rem 0.7rem;
          font-size: 0.75rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 1px 2px rgba(245, 158, 11, 0.2);
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
        }
        .btn-tariff:hover:not(:disabled) {
          background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
          transform: translateY(-1px);
          box-shadow: 0 2px 4px rgba(245, 158, 11, 0.3);
        }
        .btn-tariff:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }
        .tariff-badge {
          margin-top: 0.4rem;
          font-size: 0.75rem;
          color: #0369a1;
          background-color: #e0f2fe;
          border: 1px solid #bae6fd;
          padding: 0.4rem 0.6rem;
          border-radius: 6px;
          line-height: 1.4;
          display: flex;
          align-items: center;
          gap: 0.35rem;
        }
      `}} />

      <Header title="Utility Bill Calculator" subtitle="Compute and save your electricity and water usage" />

      {/* Auth Status Bar */}
      <div className="user-bar">
        {authLoading ? (
          <div style={{ color: '#64748b', fontSize: '0.9rem' }}>Verifying account authentication status...</div>
        ) : user ? (
          <div className="user-info">
            {user.photoURL && (
              <img 
                src={user.photoURL} 
                alt={user.displayName || 'User Profile'} 
                className="avatar" 
                referrerPolicy="no-referrer"
              />
            )}
            <div>
              <span className="welcome-text">Logged in securely as</span>
              <strong className="user-name">{user.displayName || user.email}</strong>
            </div>
            <button type="button" onClick={handleSignOut} className="btn-signout">
              Sign Out
            </button>
          </div>
        ) : (
          <div className="login-prompt">
            <span>Sign in with your Google Account to automatically save and track your utility data points.</span>
            <button type="button" onClick={handleSignIn} className="btn-signin">
              <svg className="google-icon" viewBox="0 0 24 24" width="18" height="18">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
              </svg>
              Sign in with Google
            </button>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit}>
        {/* Billing Month card */}
        <div className="card" style={{ marginBottom: '2rem' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="billing-month" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Billing Month / Period</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 'normal', color: '#64748b' }}>e.g. July 2026</span>
            </label>
            <input
              type="text"
              id="billing-month"
              className="input-field"
              placeholder="e.g. July 2026"
              value={billingMonth}
              onChange={(e) => setBillingMonth(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="grid-layout">
          {/* Electricity Card */}
          <div className="card">
            <h2 className="card-title">Electricity</h2>
            
            <div className="form-group">
              <label htmlFor="current-month-elec">Current Month Reading</label>
              <input
                {...inputProps}
                id="current-month-elec"
                placeholder="0"
                value={currentMonth}
                onChange={handleInputChange(setCurrentMonth)}
                aria-label="Current month electricity reading"
              />
            </div>

            <div className="form-group">
              <label htmlFor="last-month-elec">Last Month Reading</label>
              <input
                {...inputProps}
                id="last-month-elec"
                placeholder="0"
                value={lastMonth}
                onChange={handleInputChange(setLastMonth)}
                aria-label="Last month electricity reading"
              />
            </div>

            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.375rem' }}>
                <label htmlFor="elec-rate" style={{ margin: 0 }}>Rate ($/kWh)</label>
                <button
                  type="button"
                  onClick={() => fetchLatestTariff(true)}
                  disabled={tariffLoading}
                  className="btn-tariff"
                  title="Retrieve latest SP Group regulated quarterly tariff"
                >
                  {tariffLoading ? '⚡ Fetching...' : tariffInfo ? `⚡ Use ${tariffInfo.quarter} Rate ($${tariffInfo.rate})` : '⚡ Get Latest SP Tariff'}
                </button>
              </div>
              <input
                {...inputProps}
                id="elec-rate"
                placeholder="0.3191"
                value={electricityRate}
                onChange={handleInputChange(setElectricityRate)}
                aria-label="Electricity rate"
              />
              {tariffInfo && (
                <div className="tariff-badge">
                  <span>ℹ️ Official Regulated Rate: <strong>${tariffInfo.rate}/kWh</strong> ({tariffInfo.centsPerKwh}¢) for {tariffInfo.quarter}</span>
                </div>
              )}
            </div>

            <div className="summary-section">
              <div className="summary-row">
                <span>Usage:</span>
                <strong>{formatCurrency(electricityUsage)} units</strong>
              </div>
              <div className="summary-row total">
                <span>Electricity Total:</span>
                <strong>${formatCurrency(electricityTotal)}</strong>
              </div>
            </div>
          </div>

          {/* Water Card */}
          <div className="card">
            <h2 className="card-title">Water</h2>

            <div className="form-group">
              <label htmlFor="current-month-water">Current Month Reading</label>
              <input
                {...inputProps}
                id="current-month-water"
                placeholder="0"
                value={waterCurrentMonth}
                onChange={handleInputChange(setWaterCurrentMonth)}
                aria-label="Current month water reading"
              />
            </div>

            <div className="form-group">
              <label htmlFor="last-month-water">Last Month Reading</label>
              <input
                {...inputProps}
                id="last-month-water"
                placeholder="0"
                value={waterLastMonth}
                onChange={handleInputChange(setWaterLastMonth)}
                aria-label="Last month water reading"
              />
            </div>

            <div className="form-group">
              <label htmlFor="water-tax">Water Tax Base</label>
              <input
                {...inputProps}
                id="water-tax"
                placeholder="0"
                value={waterTax}
                onChange={handleInputChange(setWaterTax)}
                aria-label="Water tax input"
              />
            </div>

            <div className="summary-section">
              <div className="summary-row">
                <span>Usage:</span>
                <strong>{formatCurrency(waterUsage)} units</strong>
              </div>
              <div className="summary-row">
                <span>Multiplier 1 (x1.21):</span>
                <span>${formatCurrency(waterMultiplierOne)}</span>
              </div>
              <div className="summary-row">
                <span>Multiplier 2 (x0.92):</span>
                <span>${formatCurrency(waterMultiplierTwo)}</span>
              </div>
              <div className="summary-row">
                <span>Multiplier 3 (x0.5 of 1.21):</span>
                <span>${formatCurrency(waterMultiplierThree)}</span>
              </div>
              <div className="summary-row">
                <span>Water tax (x0.5):</span>
                <span>${formatCurrency(waterTaxFinalCost)}</span>
              </div>
              <div className="summary-row total">
                <span>Water Total:</span>
                <strong>${formatCurrency(waterFinalTotal + waterTaxFinalCost)}</strong>
              </div>
            </div>
          </div>
        </div>

        {/* Subtotal and Save Card */}
        <div className="card" style={{ marginTop: '2rem' }}>
          <h2 className="card-title" style={{ borderBottom: 'none', marginBottom: '0.5rem' }}>Calculation Summary</h2>
          
          <div className="summary-row grand-total">
            <span>Combined Total (with 9% tax):</span>
            <span>${formatCurrency(combinedTotal)}</span>
          </div>

          {user ? (
            <button className="btn-save" type="submit" disabled={status === 'submitting'}>
              {status === 'submitting' ? 'Saving calculation…' : 'Save calculation'}
            </button>
          ) : (
            <button className="btn-save" type="button" onClick={handleSignIn}>
              Sign in with Google to save
            </button>
          )}

          {status === 'success' && (
            <div className="status-msg status-success" role="status">
              Calculation saved successfully in Firebase database!
            </div>
          )}
          {error && (
            <div className="status-msg status-error" role="alert">
              {error}
            </div>
          )}
        </div>
      </form>

      {/* Historical List */}
      {user && (
        <div className="card" style={{ marginTop: '2rem' }}>
          <h2 className="card-title">Saved History</h2>
          {historyLoading ? (
            <div className="loading-spinner">Loading calculation history...</div>
          ) : history.length === 0 ? (
            <div className="empty-history">
              No calculations saved yet. Enter readings and click &quot;Save calculation&quot; above.
            </div>
          ) : (
            <div className="history-list">
              {history.map((item) => (
                <div key={item.id} className="history-item">
                  <div className="history-header">
                    <span className="history-month">{item.billingMonth}</span>
                    <span className="history-date">
                      {item.createdAt?.seconds 
                        ? new Date(item.createdAt.seconds * 1000).toLocaleDateString()
                        : 'Just now'}
                    </span>
                  </div>
                  <div className="history-details">
                    <div className="history-detail-col">
                      <span>Electricity:</span>
                      <strong>${formatCurrency(item.electricity?.total || 0)}</strong>
                    </div>
                    <div className="history-detail-col">
                      <span>Water:</span>
                      <strong>${formatCurrency((item.water?.total || 0) + (item.water?.taxFinalCost || 0))}</strong>
                    </div>
                    <div className="history-detail-col">
                      <span>Combined Total:</span>
                      <strong className="text-blue">${formatCurrency(item.combinedTotal || 0)}</strong>
                    </div>
                  </div>
                  <div className="history-actions">
                    <button 
                      type="button" 
                      onClick={() => loadHistoryEntry(item)} 
                      className="btn-action-load"
                      title="Load values into calculator"
                    >
                      Load Into Calculator
                    </button>
                    {deleteConfirmId === item.id ? (
                      <>
                        <button 
                          type="button" 
                          onClick={() => deleteHistoryEntry(item.id)} 
                          className="btn-action-confirm-delete"
                          title="Confirm deletion"
                        >
                          Confirm
                        </button>
                        <button 
                          type="button" 
                          onClick={() => setDeleteConfirmId(null)} 
                          className="btn-action-cancel-delete"
                          title="Cancel deletion"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button 
                        type="button" 
                        onClick={() => setDeleteConfirmId(item.id)} 
                        className="btn-action-delete"
                        title="Delete from history"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


