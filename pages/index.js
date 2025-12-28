import { useMemo, useState } from 'react';

function Header({ title }) {
  return <h1>{title ? title : 'Default title'}</h1>;
}

const formatCurrency = (value) => {
  if (Number.isNaN(value)) return '';
  return value.toFixed(2);
};

export default function HomePage() {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);

  const [currentMonth, setCurrentMonth] = useState('');
  const [lastMonth, setLastMonth] = useState('');
  const [electricityRate, setElectricityRate] = useState('');

  const [waterCurrentMonth, setWaterCurrentMonth] = useState('');
  const [waterLastMonth, setWaterLastMonth] = useState('');
  const [waterTax, setWaterTax] = useState('');

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
      (electricityTotal + waterFinalTotal + waterTaxFinalCost) * 1.09 + 0.5,
    [electricityTotal, waterFinalTotal, waterTaxFinalCost]
  );

  async function handleSubmit(event) {
    event.preventDefault();
    setStatus('submitting');
    setError(null);
    try {
      await submitForm(currentMonth);
      setStatus('success');
    } catch (err) {
      setStatus('typing');
      setError(err.message || 'Something went wrong');
    }
  }

  const inputProps = {
    type: 'number',
    step: '0.01',
    inputMode: 'decimal',
    min: '0',
  };

  return (
    <div>
      <Header title="Utility Demo App" />

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '1rem' }}>
        <fieldset>
          <legend>Electricity</legend>
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            <label>
              <span>Current month reading</span>
              <input
                {...inputProps}
                placeholder="0"
                value={currentMonth}
                onChange={(e) => setCurrentMonth(e.target.value)}
                aria-label="Current month electricity reading"
              />
            </label>
            <label>
              <span>Last month reading</span>
              <input
                {...inputProps}
                placeholder="0"
                value={lastMonth}
                onChange={(e) => setLastMonth(e.target.value)}
                aria-label="Last month electricity reading"
              />
            </label>
            <div>
              <strong>Usage:</strong>{' '}
              <output aria-live="polite">{formatCurrency(electricityUsage)}</output>
            </div>
            <label>
              <span>Rate</span>
              <input
                {...inputProps}
                placeholder="0.2895"
                value={electricityRate}
                onChange={(e) => setElectricityRate(e.target.value)}
                aria-label="Electricity rate"
              />
            </label>
            <div>
              <strong>Total:</strong>{' '}
              <output aria-live="polite">{formatCurrency(electricityTotal)}</output>
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend>Water</legend>
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            <label>
              <span>Current month reading</span>
              <input
                {...inputProps}
                placeholder="0"
                value={waterCurrentMonth}
                onChange={(e) => setWaterCurrentMonth(e.target.value)}
                aria-label="Current month water reading"
              />
            </label>
            <label>
              <span>Last month reading</span>
              <input
                {...inputProps}
                placeholder="0"
                value={waterLastMonth}
                onChange={(e) => setWaterLastMonth(e.target.value)}
                aria-label="Last month water reading"
              />
            </label>
            <div>
              <strong>Usage:</strong>{' '}
              <output aria-live="polite">{formatCurrency(waterUsage)}</output>
            </div>
            <div>
              <strong>Multiplier 1 (x1.21):</strong>{' '}
              <output aria-live="polite">{formatCurrency(waterMultiplierOne)}</output>
            </div>
            <div>
              <strong>Multiplier 2 (x0.92):</strong>{' '}
              <output aria-live="polite">{formatCurrency(waterMultiplierTwo)}</output>
            </div>
            <div>
              <strong>Multiplier 3 (x0.5 of 1.21):</strong>{' '}
              <output aria-live="polite">{formatCurrency(waterMultiplierThree)}</output>
            </div>
            <div>
              <strong>Water total:</strong>{' '}
              <output aria-live="polite">{formatCurrency(waterFinalTotal)}</output>
            </div>
            <label>
              <span>Water tax base</span>
              <input
                {...inputProps}
                placeholder="0"
                value={waterTax}
                onChange={(e) => setWaterTax(e.target.value)}
                aria-label="Water tax input"
              />
            </label>
            <div>
              <strong>Water tax (x0.5):</strong>{' '}
              <output aria-live="polite">{formatCurrency(waterTaxFinalCost)}</output>
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend>Subtotal</legend>
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            <div>
              <strong>Combined total (with 9% + 0.5):</strong>{' '}
              <output aria-live="polite">{formatCurrency(combinedTotal)}</output>
            </div>
            <button type="submit" disabled={status === 'submitting'}>
              {status === 'submitting' ? 'Calculating…' : 'Save calculation'}
            </button>
            {status === 'success' && <p role="status">Saved!</p>}
            {error && (
              <p role="alert" style={{ color: 'red' }}>
                {error}
              </p>
            )}
          </div>
        </fieldset>
      </form>
    </div>
  );

  function submitForm(value) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        const shouldError = Number(value || 0) <= 0;
        if (shouldError) {
          reject(new Error('Enter a current month reading greater than 0.'));
        } else {
          resolve();
        }
      }, 500);
    });
  }
}
