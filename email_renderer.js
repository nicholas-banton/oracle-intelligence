"use strict";

// Oracle email renderer. Pure presentation layer: no trading or policy logic.
// Converts Oracle's existing plain-text alerts into email-safe HTML while
// preserving the original text as the fallback body.

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function severityFromSubject(subject = "") {
  const s = String(subject).toUpperCase();
  if (s.includes("DEFCON 1") || s.includes("CRITICAL") || s.includes("FATAL")) {
    return { label: "CRITICAL", accent: "#b42318", soft: "#fee4e2", ink: "#7a271a", icon: "🚨" };
  }
  if (s.includes("DEFCON 2") || s.includes("WARNING") || s.includes("HEARTBEAT")) {
    return { label: "ELEVATED", accent: "#b54708", soft: "#fef0c7", ink: "#7a2e0e", icon: "⚠️" };
  }
  if (s.includes("DEFCON 3") || s.includes("ADVISORY")) {
    return { label: "ADVISORY", accent: "#175cd3", soft: "#dbeafe", ink: "#1849a9", icon: "ℹ️" };
  }
  if (s.includes("OUTCOME") || s.includes("SCORECARD") || s.includes("CORRECT")) {
    return { label: "REVIEW", accent: "#067647", soft: "#dcfae6", ink: "#05603a", icon: "✓" };
  }
  if (s.includes("SCENARIO") || s.includes("ORACLE V2") || s.includes("STRATEGIC")) {
    return { label: "STRATEGIC", accent: "#6938ef", soft: "#ebe9fe", ink: "#53389e", icon: "◈" };
  }
  return { label: "ORACLE", accent: "#344054", soft: "#f2f4f7", ink: "#1d2939", icon: "◈" };
}

function isHeading(line) {
  const t = line.trim();
  if (!t) return false;
  if (/^[A-Z0-9][A-Z0-9 /&()_.-]{2,}:$/.test(t)) return true;
  if (/^[─━-]{4,}/.test(t)) return true;
  return false;
}

function parseBody(body = "") {
  const lines = String(body).replace(/\r/g, "").split("\n");
  const sections = [];
  let current = { title: "Summary", lines: [] };

  function flush() {
    if (current.lines.some(x => x.trim())) sections.push(current);
  }

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (isHeading(line)) {
      flush();
      const clean = line.replace(/^[─━-]+|[─━-]+$/g, "").replace(/:$/, "").trim();
      current = { title: clean || "Details", lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  flush();
  return sections.length ? sections : [{ title: "Summary", lines }];
}

function splitMetrics(lines) {
  const metrics = [];
  const narrative = [];
  for (const line of lines) {
    const m = line.match(/^[-•]?\s*([^:]{2,42}):\s*(.+)$/);
    if (m && !/https?:\/\//i.test(line)) {
      metrics.push({ label: m[1].trim(), value: m[2].trim() });
    } else if (line.trim()) {
      narrative.push(line.trim());
    }
  }
  return { metrics, narrative };
}

function renderMetricCards(metrics) {
  if (!metrics.length) return "";
  const cards = metrics.slice(0, 8).map(m => `
    <td style="padding:0 8px 12px 0;vertical-align:top;width:50%;">
      <div style="border:1px solid #eaecf0;border-radius:10px;padding:12px 14px;background:#ffffff;">
        <div style="font-size:11px;line-height:16px;color:#667085;text-transform:uppercase;letter-spacing:.04em;">${esc(m.label)}</div>
        <div style="font-size:16px;line-height:22px;color:#101828;font-weight:700;margin-top:2px;">${esc(m.value)}</div>
      </div>
    </td>`).join("");

  let rows = "";
  for (let i = 0; i < metrics.slice(0, 8).length; i += 2) {
    rows += `<tr>${cards.split("</td>").slice(i, i + 2).map(x => x ? x + "</td>" : "").join("")}</tr>`;
  }
  // The split approach above is intentionally simple but can be fragile if card
  // markup changes. Rebuild safely when an odd count is present.
  const cells = metrics.slice(0, 8).map(m => `
    <td style="padding:0 8px 12px 0;vertical-align:top;width:50%;">
      <div style="border:1px solid #eaecf0;border-radius:10px;padding:12px 14px;background:#ffffff;">
        <div style="font-size:11px;line-height:16px;color:#667085;text-transform:uppercase;letter-spacing:.04em;">${esc(m.label)}</div>
        <div style="font-size:16px;line-height:22px;color:#101828;font-weight:700;margin-top:2px;">${esc(m.value)}</div>
      </div>
    </td>`);
  rows = "";
  for (let i = 0; i < cells.length; i += 2) {
    rows += `<tr>${cells[i]}${cells[i + 1] || '<td style="width:50%;"></td>'}</tr>`;
  }
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-top:8px;">${rows}</table>`;
}

function renderNarrative(lines) {
  if (!lines.length) return "";
  const listish = lines.filter(x => /^[-•]|^\d+[.)]\s/.test(x)).length >= Math.max(2, Math.floor(lines.length / 2));
  if (listish) {
    const items = lines.map(x => x.replace(/^[-•]\s*/, "").replace(/^\d+[.)]\s*/, "")).map(x => `<li style="margin:0 0 7px 0;">${esc(x)}</li>`).join("");
    return `<ul style="margin:8px 0 0 20px;padding:0;color:#344054;font-size:14px;line-height:21px;">${items}</ul>`;
  }
  return lines.map(x => `<p style="margin:7px 0;color:#344054;font-size:14px;line-height:21px;">${esc(x)}</p>`).join("");
}

function renderOracleEmail({ subject, body, footer = "Oracle is watching." } = {}) {
  const sev = severityFromSubject(subject);
  const sections = parseBody(body);
  const first = sections[0] || { title: "Summary", lines: [] };
  const firstText = first.lines.find(x => x.trim()) || "Oracle strategic update.";

  const sectionHtml = sections.map((section, idx) => {
    const { metrics, narrative } = splitMetrics(section.lines);
    const title = idx === 0 && /^summary$/i.test(section.title) ? "At a glance" : section.title;
    return `
      <div style="margin-top:${idx === 0 ? 16 : 22}px;">
        <div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:${sev.ink};margin-bottom:7px;">${esc(title)}</div>
        ${renderMetricCards(metrics)}
        ${renderNarrative(narrative)}
      </div>`;
  }).join("");

  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#101828;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:24px 10px;">
    <tr><td align="center">
      <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;background:#ffffff;border:1px solid #eaecf0;border-radius:16px;overflow:hidden;">
        <tr><td style="height:7px;background:${sev.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:24px 26px 8px 26px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
            <td style="vertical-align:middle;">
              <div style="font-size:13px;color:#667085;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">Oracle Strategic Intelligence</div>
              <div style="font-size:24px;line-height:31px;font-weight:800;color:#101828;margin-top:6px;">${esc(subject || "Oracle Update")}</div>
            </td>
            <td align="right" style="vertical-align:top;width:120px;">
              <span style="display:inline-block;background:${sev.soft};color:${sev.ink};border-radius:999px;padding:7px 11px;font-size:11px;font-weight:800;letter-spacing:.06em;">${sev.icon} ${sev.label}</span>
            </td>
          </tr></table>
          <div style="margin-top:16px;border-left:4px solid ${sev.accent};background:${sev.soft};padding:12px 14px;border-radius:0 8px 8px 0;font-size:15px;line-height:22px;color:${sev.ink};font-weight:600;">${esc(firstText)}</div>
          ${sectionHtml}
        </td></tr>
        <tr><td style="padding:18px 26px 24px 26px;">
          <div style="border-top:1px solid #eaecf0;padding-top:14px;color:#667085;font-size:12px;line-height:18px;">
            ${esc(footer)}<br>
            <span style="color:#98a2b3;">Presentation layer only. Oracle's policy and execution authority are unchanged by this email format.</span>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

module.exports = { esc, severityFromSubject, parseBody, renderOracleEmail };
