import nodemailer from "nodemailer";

// ---------------------------------------------------------------------------
// Email service for new enquiries.
//   * 3 team members are notified: NOTIFY_EMAILS (comma separated) + EMPLOYEE_EMAIL
//   * the person who submitted the enquiry gets an automatic thank-you email
// Every recipient is sent a separate message (nobody sees the others' addresses) and the
// result of each send is returned so it can be stored and shown to the admin.
// ---------------------------------------------------------------------------

let cached = { key: "", transport: null };

export function smtpConfigured() {
  return Boolean(
    process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS,
  );
}

function getTransport() {
  if (!smtpConfigured()) return null;
  const key = [
    process.env.SMTP_HOST,
    process.env.SMTP_PORT,
    process.env.SMTP_SECURE,
    process.env.SMTP_USER,
  ].join("|");
  if (cached.key !== key) {
    cached = {
      key,
      transport: nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: String(process.env.SMTP_SECURE).toLowerCase() === "true",
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      }),
    };
  }
  return cached.transport;
}

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]{2,}$/;
export const isValidEmail = (value) =>
  typeof value === "string" && value.length <= 254 && EMAIL_RE.test(value);

const escapeHtml = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const clean = (v) =>
  String(v ?? "")
    .replace(/[\r\n<>]/g, " ")
    .trim();

/** The people who must be told about every new enquiry (de-duplicated, invalid values skipped). */
export function teamRecipients() {
  const list = [
    ...(process.env.NOTIFY_EMAILS || "").split(","),
    process.env.EMPLOYEE_EMAIL || "",
  ]
    .map((x) => x.trim().toLowerCase())
    .filter(isValidEmail);
  return [...new Set(list)];
}

function teamMessage(lead) {
  const adminUrl =
    process.env.ADMIN_DASHBOARD_URL || "http://localhost:5173/admin";
  const rows = [
    ["Lead ID", lead.referenceId],
    ["Name", lead.name],
    ["Email", lead.email],
    ["Mobile", lead.phone],
    ["Category", lead.category],
    ["Skills", lead.skills],
    ["Experience", lead.experience],
    ["Goal", lead.goal],
    ["Message", lead.message || "-"],
    ["Submitted", new Date(lead.createdAt).toISOString()],
    ["Lead source", lead.leadSource],
  ];
  const text =
    rows.map(([k, v]) => `${k}: ${clean(v)}`).join("\n") +
    `\nAdmin dashboard: ${adminUrl}`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;color:#292329">
    <h2 style="color:#bd1e35;margin:0 0 12px">New Talent Forge enquiry</h2>
    <table style="border-collapse:collapse;width:100%">${rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee7e9;color:#79717a;width:130px">${escapeHtml(k)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee7e9">${escapeHtml(v)}</td></tr>`,
      )
      .join("")}</table>
    <p><a href="${escapeHtml(adminUrl)}" style="background:#bd1e35;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">Open admin dashboard</a></p></div>`;
  return {
    subject: `New Talent Forge Membership Enquiry - ${lead.referenceId}`,
    text,
    html,
  };
}

function thankYouMessage(lead) {
  const url =
    process.env.OFFICIAL_MEMBERSHIP_URL ||
    "https://alphaauron.com/talent-forge";
  const name = clean(lead.name);
  const text = `Hi ${name},\n\nThank you for your interest in Talent Forge. We have received your membership enquiry and a representative will review it and contact you.\n\nEnquiry Reference ID: ${lead.referenceId}\nCategory: ${clean(lead.category)}\nOfficial membership page: ${url}\n\nTalent Forge Team\nAlpha Auron Private Limited`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;color:#292329;line-height:1.6">
    <h2 style="color:#bd1e35;margin:0 0 12px">Thank you for your interest in Talent Forge!</h2>
    <p>Hi ${escapeHtml(name)},</p>
    <p>We have received your membership enquiry and a representative will review it and contact you.</p>
    <p style="background:#fff5f6;border:1px solid #f2dfe3;border-radius:8px;padding:12px 14px">Enquiry Reference ID: <b>${escapeHtml(lead.referenceId)}</b><br>Category: ${escapeHtml(lead.category)}</p>
    <p><a href="${escapeHtml(url)}">Official membership page</a></p>
    <p>Talent Forge Team<br>Alpha Auron Private Limited</p></div>`;
  return {
    subject: "Thank You for Your Interest in Talent Forge!",
    text,
    html,
  };
}

async function sendOne(transport, { to, kind, message, replyTo }) {
  try {
    const info = await transport.sendMail({
      from: process.env.MAIL_FROM,
      to,
      replyTo,
      ...message,
    });
    // "sent" = the SMTP server accepted this recipient. Inbox delivery cannot be proven from here.
    const accepted = (info.accepted || []).map((a) => String(a).toLowerCase());
    if (!accepted.includes(to.toLowerCase()))
      return {
        to,
        kind,
        status: "failed",
        error: "Recipient rejected by SMTP server",
      };
    return { to, kind, status: "sent" };
  } catch (err) {
    return {
      to,
      kind,
      status: "failed",
      error: String(err.message || err).slice(0, 300),
    };
  }
}

/**
 * Sends the 3 team notifications and the customer thank-you.
 * `only` (optional array of addresses) limits sending, used to retry failed recipients.
 */
export async function sendLeadEmails(lead, only = null) {
  const transport = getTransport();
  if (!transport)
    return { configured: false, summary: "not-configured", results: [] };

  const wanted = only ? new Set(only.map((x) => x.toLowerCase())) : null;
  const jobs = [];
  const team = teamMessage(lead);
  for (const to of teamRecipients()) {
    if (!wanted || wanted.has(to))
      jobs.push({ to, kind: "team", message: team, replyTo: lead.email });
  }
  if (!wanted || wanted.has(lead.email.toLowerCase()))
    jobs.push({
      to: lead.email,
      kind: "customer",
      message: thankYouMessage(lead),
    });

  const results = await Promise.all(jobs.map((job) => sendOne(transport, job)));
  const ok = results.filter((r) => r.status === "sent").length;
  const summary =
    results.length === 0
      ? "not-configured"
      : ok === results.length
        ? "sent"
        : ok === 0
          ? "failed"
          : "partial";
  return { configured: true, summary, results };
}
