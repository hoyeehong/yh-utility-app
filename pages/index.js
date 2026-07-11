import { useCallback, useEffect, useMemo, useState } from 'react';

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

  // LocalStorage History State
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
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

  // Load LocalStorage History on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('utility_calculations_v1');
      if (saved) {
        setHistory(JSON.parse(saved));
      }
    } catch (err) {
      console.error('Failed to load local history:', err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const saveToLocalStorage = (newHistory) => {
    try {
      localStorage.setItem('utility_calculations_v1', JSON.stringify(newHistory));
      setHistory(newHistory);
    } catch (err) {
      setError('Failed to save to local storage: ' + err.message);
    }
  };

  const clearAllHistory = () => {
    if (window.confirm('Are you sure you want to delete all saved calculation history from this device?')) {
      saveToLocalStorage([]);
    }
  };

  const exportHistoryJSON = () => {
    if (history.length === 0) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(history, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `utility_bills_backup_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const exportHistoryCSV = () => {
    if (history.length === 0) return;
    const headers = ['ID', 'Billing Month', 'Date', 'Electricity Usage (units)', 'Electricity Rate ($/kWh)', 'Electricity Total ($)', 'Water Usage (units)', 'Water Tax Base ($)', 'Water Total ($)', 'Combined Total ($)'];
    const rows = history.map(item => [
      item.id,
      `"${item.billingMonth || ''}"`,
      item.createdAt?.seconds ? new Date(item.createdAt.seconds * 1000).toLocaleDateString() : '',
      item.electricity?.usage || 0,
      item.electricity?.rate || 0,
      item.electricity?.total || 0,
      item.water?.usage || 0,
      item.water?.taxBase || 0,
      (item.water?.total || 0) + (item.water?.taxFinalCost || 0),
      item.combinedTotal || 0
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", encodeURI(csvContent));
    downloadAnchor.setAttribute("download", `utility_bills_backup_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

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

  const deleteHistoryEntry = (id) => {
    try {
      const updatedHistory = history.filter((item) => item.id !== id);
      saveToLocalStorage(updatedHistory);
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

  function handleSubmit(event) {
    event.preventDefault();
    setStatus('submitting');
    setError(null);
    try {
      const newRecord = {
        id: 'calc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        billingMonth,
        createdAt: { seconds: Math.floor(Date.now() / 1000) },
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

      const updatedHistory = [newRecord, ...history];
      saveToLocalStorage(updatedHistory);
      setStatus('success');
    } catch (err) {
      setStatus('idle');
      setError(err.message || 'Failed to save calculation');
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
        .storage-bar {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 1rem 1.5rem;
          margin-bottom: 2rem;
          box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05);
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 1rem;
        }
        .storage-info {
          display: flex;
          align-items: center;
          gap: 0.85rem;
        }
        .storage-icon {
          width: 40px;
          height: 40px;
          border-radius: 10px;
          background-color: #e0f2fe;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.25rem;
        }
        .storage-title {
          display: block;
          font-size: 0.75rem;
          color: #0284c7;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          font-weight: 700;
        }
        .storage-desc {
          font-size: 0.95rem;
          color: #0f172a;
          font-weight: 600;
        }
        .history-bulk-actions {
          display: flex;
          gap: 0.6rem;
          flex-wrap: wrap;
          align-items: center;
        }
        .btn-bulk {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          padding: 0.45rem 0.8rem;
          border-radius: 6px;
          font-size: 0.8rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }
        .btn-export-json {
          background-color: #eff6ff;
          color: #1d4ed8;
          border: 1px solid #bfdbfe;
        }
        .btn-export-json:hover {
          background-color: #dbeafe;
        }
        .btn-export-csv {
          background-color: #f0fdf4;
          color: #15803d;
          border: 1px solid #bbf7d0;
        }
        .btn-export-csv:hover {
          background-color: #dcfce7;
        }
        .btn-clear-all {
          background-color: #fef2f2;
          color: #dc2626;
          border: 1px solid #fecaca;
        }
        .btn-clear-all:hover {
          background-color: #fee2e2;
        }
      `}} />

      <Header title="Utility Bill Calculator" subtitle="Compute and save your electricity and water usage" />

      {/* Storage Mode Bar */}
      <div className="storage-bar">
        <div className="storage-info">
          <div className="storage-icon">💾</div>
          <div>
            <span className="storage-title">Client-Side Storage Mode</span>
            <span className="storage-desc">Local Device Storage (100% Private & Offline Ready)</span>
          </div>
        </div>
        <div style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 500 }}>
          No cloud login required. Data is saved directly to this device.
        </div>
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

          <button className="btn-save" type="submit" disabled={status === 'submitting'}>
            {status === 'submitting' ? 'Saving to device…' : 'Save calculation to Device'}
          </button>

          {status === 'success' && (
            <div className="status-msg status-success" role="status">
              Calculation saved successfully to your local device storage!
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
      <div className="card" style={{ marginTop: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '1rem', marginBottom: '1.5rem' }}>
          <h2 className="card-title" style={{ margin: 0, borderBottom: 'none', paddingBottom: 0 }}>Saved History</h2>
          {history.length > 0 && (
            <div className="history-bulk-actions">
              <button type="button" onClick={exportHistoryJSON} className="btn-bulk btn-export-json" title="Export as JSON file">
                📥 Export JSON
              </button>
              <button type="button" onClick={exportHistoryCSV} className="btn-bulk btn-export-csv" title="Export as CSV spreadsheet">
                📊 Export CSV
              </button>
              <button type="button" onClick={clearAllHistory} className="btn-bulk btn-clear-all" title="Delete all records from this device">
                🗑️ Clear All
              </button>
            </div>
          )}
        </div>

        {historyLoading ? (
          <div className="loading-spinner">Loading calculation history from device...</div>
        ) : history.length === 0 ? (
          <div className="empty-history">
            No calculations saved yet on this device. Enter readings and click &quot;Save calculation to Device&quot; above.
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
    </div>
  );
}


