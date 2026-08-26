/**
 * lib/history.js — Firestore bill record CRUD (replaces Supabase-backed history.js)
 *
 * Data model (per user):
 *   users/{uid}/bill_records/{recordId}
 *     billingMonth:   string
 *     createdAt:      Timestamp
 *     electricity:    { currentReading, lastReading, usage, rate, total }
 *     water:          { currentReading, lastReading, usage, multiplierOne,
 *                       multiplierTwo, multiplierThree, taxBase, taxFinalCost, total }
 *     combinedTotal:  number
 *     summaryText:    string   (human-readable, used for vector embedding)
 *
 * Note: Firestore vector embeddings are written by the ADK Python backend,
 * not by this client-side module, to keep API keys server-side.
 */

import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
  limit,
  getDocs,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';

// ─── Collection reference helper ─────────────────────────────────────────────

function billsCol(uid) {
  return collection(db, 'users', uid, 'bill_records');
}

// ─── Build human-readable summary for the ADK backend to embed ───────────────

export function buildSummaryText(record) {
  const e = record.electricity || {};
  const w = record.water || {};
  return (
    `Billing month: ${record.billingMonth || 'unknown'}. ` +
    `Electricity usage: ${e.usage ?? 0} kWh at $${e.rate ?? 0}/kWh, total $${(e.total ?? 0).toFixed(2)}. ` +
    `Water usage: ${w.usage ?? 0} m³, total $${(w.total ?? 0).toFixed(2)}. ` +
    `Combined bill (incl. 9% GST): $${(record.combinedTotal ?? 0).toFixed(2)}.`
  );
}

// ─── Save a new bill record ───────────────────────────────────────────────────

/**
 * Save a bill calculation record to Firestore.
 * Returns the Firestore document reference.
 */
export async function saveRecord(uid, record) {
  const summaryText = buildSummaryText(record);
  const docRef = await addDoc(billsCol(uid), {
    billingMonth:  record.billingMonth  || '',
    createdAt:     serverTimestamp(),
    electricity:   record.electricity   || {},
    water:         record.water         || {},
    combinedTotal: record.combinedTotal || 0,
    photoUrls:     record.photoUrls     || {},
    summaryText,
  });
  return docRef;
}

// ─── Delete a bill record ─────────────────────────────────────────────────────

export async function deleteRecord(uid, recordId) {
  await deleteDoc(doc(db, 'users', uid, 'bill_records', recordId));
}

// ─── Fetch all records once (sorted newest-first) ────────────────────────────

export async function listRecords(uid) {
  const q = query(billsCol(uid), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ─── Real-time listener (returns unsubscribe fn) ──────────────────────────────

/**
 * Subscribe to the user's bill records in real-time.
 * @param {string} uid
 * @param {function} callback — called with an array of records on every change
 * @returns {function} unsubscribe
 */
export function subscribeToRecords(uid, callback) {
  const q = query(billsCol(uid), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snap) => {
    const records = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(records);
  });
}

// ─── Get last reading (for auto-fill on subsequent sessions) ──────────────────

/**
 * Returns the most recent bill's currentReading values to use as lastReading
 * for the next session.
 *
 * @param {string} uid
 * @returns {{ electricityLastReading: number|null, waterLastReading: number|null }}
 */
export async function getLastReading(uid) {
  const q = query(billsCol(uid), orderBy('createdAt', 'desc'), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) {
    return { electricityLastReading: null, waterLastReading: null };
  }
  const record = snap.docs[0].data();
  return {
    electricityLastReading: record.electricity?.currentReading ?? null,
    waterLastReading:       record.water?.currentReading       ?? null,
  };
}
