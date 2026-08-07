import { supabase } from './supabase';

const LOCAL_KEY = 'utility_calculations_v2';
const LEGACY_LOCAL_KEY = 'utility_calculations_v1';

// Canonical app record shape, produced by every function below:
//
//   {
//     id, billingMonth,
//     createdAt: string,                 // ISO 8601
//     electricity: { currentReading, lastReading, usage, rate, total },
//     water: { currentReading, lastReading, usage, multiplierOne, multiplierTwo,
//              multiplierThree, taxBase, taxFinalCost, total },
//     combinedTotal
//   }
//
// The UI never sees a Postgres row or a snake_case key.

const num = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function rowToRecord(row) {
  return {
    id: row.id,
    billingMonth: row.billing_month || '',
    createdAt: row.created_at,
    electricity: {
      currentReading: num(row.elec_current),
      lastReading: num(row.elec_last),
      usage: num(row.elec_usage),
      rate: num(row.elec_rate),
      total: num(row.elec_total),
    },
    water: {
      currentReading: num(row.water_current),
      lastReading: num(row.water_last),
      usage: num(row.water_usage),
      multiplierOne: num(row.water_mult_one),
      multiplierTwo: num(row.water_mult_two),
      multiplierThree: num(row.water_mult_three),
      taxBase: num(row.water_tax_base),
      taxFinalCost: num(row.water_tax_final),
      total: num(row.water_total),
    },
    combinedTotal: num(row.combined_total),
  };
}

export function recordToRow(record, userId) {
  const electricity = record.electricity || {};
  const water = record.water || {};
  return {
    user_id: userId,
    billing_month: record.billingMonth || '',
    elec_current: num(electricity.currentReading),
    elec_last: num(electricity.lastReading),
    elec_usage: num(electricity.usage),
    elec_rate: num(electricity.rate),
    elec_total: num(electricity.total),
    water_current: num(water.currentReading),
    water_last: num(water.lastReading),
    water_usage: num(water.usage),
    water_mult_one: num(water.multiplierOne),
    water_mult_two: num(water.multiplierTwo),
    water_mult_three: num(water.multiplierThree),
    water_tax_base: num(water.taxBase),
    water_tax_final: num(water.taxFinalCost),
    water_total: num(water.total),
    combined_total: num(record.combinedTotal),
  };
}

/* ------------------------------------------------------------------ cloud */

export async function listHistory(userId) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('calculations')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToRecord);
}

export async function insertHistory(record, userId) {
  if (!supabase) throw new Error('Cloud storage is not configured.');
  const { data, error } = await supabase
    .from('calculations')
    .insert(recordToRow(record, userId))
    .select()
    .single();
  if (error) throw error;
  return rowToRecord(data);
}

export async function deleteHistory(id) {
  if (!supabase) throw new Error('Cloud storage is not configured.');
  const { error } = await supabase.from('calculations').delete().eq('id', id);
  if (error) throw error;
}

// One statement, rather than one round trip per record.
export async function clearHistory(userId) {
  if (!supabase) throw new Error('Cloud storage is not configured.');
  const { error } = await supabase.from('calculations').delete().eq('user_id', userId);
  if (error) throw error;
}

/* ------------------------------------------------------------------ local */

// v1 stored createdAt as a Firestore-style { seconds } object. Read those once
// and rewrite them as ISO strings so existing offline users keep their history.
function migrateLegacyRecords() {
  const legacy = window.localStorage.getItem(LEGACY_LOCAL_KEY);
  if (!legacy) return null;

  let parsed;
  try {
    parsed = JSON.parse(legacy);
  } catch (err) {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const migrated = parsed.map((item) => ({
    ...item,
    createdAt:
      typeof item.createdAt === 'string'
        ? item.createdAt
        : new Date((item.createdAt?.seconds ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
  }));

  window.localStorage.setItem(LOCAL_KEY, JSON.stringify(migrated));
  return migrated;
}

export const local = {
  list() {
    if (typeof window === 'undefined') return [];
    const saved = window.localStorage.getItem(LOCAL_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return Array.isArray(parsed) ? parsed : [];
      } catch (err) {
        return [];
      }
    }
    return migrateLegacyRecords() || [];
  },

  save(records) {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(records));
  },

  insert(record) {
    const next = [
      { ...record, id: `calc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}` },
      ...local.list(),
    ];
    local.save(next);
    return next;
  },

  remove(id) {
    const next = local.list().filter((item) => item.id !== id);
    local.save(next);
    return next;
  },

  clear() {
    local.save([]);
    return [];
  },
};
