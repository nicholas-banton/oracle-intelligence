"use strict";

const MAX_ROWS = 260; // roughly one trading year of daily records

function normalizeLedger(value) {
  const rows = Array.isArray(value) ? value : Array.isArray(value?.records) ? value.records : [];
  return rows.filter(x => x && typeof x === "object").slice(-MAX_ROWS);
}

function upsertRecord(ledger, record) {
  const rows = normalizeLedger(ledger).slice();
  if (!record?.id) throw new Error("Oracle v2 ledger record requires id");
  const idx = rows.findIndex(x => x.id === record.id);
  if (idx >= 0) rows[idx] = { ...rows[idx], ...record };
  else rows.push(record);
  rows.sort((a, b) => String(a.asOf || "").localeCompare(String(b.asOf || "")));
  return rows.slice(-MAX_ROWS);
}

function ledgerEnvelope(records, meta = {}) {
  return {
    schemaVersion: "2.0",
    mode: "shadow_advisory",
    authority: {
      canTrade: false,
      canSetTargetWeights: false,
      canOverrideSavant: false,
      canIncreaseRisk: false,
    },
    updatedAt: new Date().toISOString(),
    records: normalizeLedger(records),
    ...meta,
  };
}

module.exports = { MAX_ROWS, normalizeLedger, upsertRecord, ledgerEnvelope };
