import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import "./notifications.css";

const EMAIL_STATUS_TEXT = {
  sent: "All emails were accepted by the mail server.",
  partial: "Some emails failed. You can resend only the failed ones.",
  failed: "No email could be sent. You can try again.",
  "not-configured": "Email is not set up on the server yet (SMTP settings missing in backend/.env).",
  pending: "Email status is not recorded for this enquiry."
};

export default function LeadDetails({ lead, onClose, onResend }) {
  const closeRef = useRef(null);
  const [resending, setResending] = useState(false);
  const [resendMsg, setResendMsg] = useState("");

  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus?.(); };
  }, [onClose]);

  const rows = [
    ["Lead ID", lead.referenceId], ["Name", lead.name], ["Email", lead.email], ["Mobile", lead.phone],
    ["Category", lead.category], ["Skills", lead.skills], ["Experience", lead.experience], ["Goal", lead.goal],
    ["Message", lead.message || "-"], ["Status", lead.status], ["Follow-up notes", lead.followUp || "-"],
    ["Submitted", new Date(lead.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })]
  ];
  const canResend = ["partial", "failed"].includes(lead.notificationStatus);

  async function resend() {
    setResending(true); setResendMsg("");
    const ok = await onResend(lead);
    setResendMsg(ok ? "Resent. Status updated." : "Could not resend. Check the server and SMTP settings.");
    setResending(false);
  }

  return (
    <div className="tf-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tf-modal" role="dialog" aria-modal="true" aria-labelledby="tf-lead-title">
        <header>
          <div><span className="eyebrow">ENQUIRY DETAILS</span><h2 id="tf-lead-title">{lead.name}</h2></div>
          <button ref={closeRef} type="button" className="tf-modal-close" onClick={onClose} aria-label="Close details"><X size={18} aria-hidden="true" /></button>
        </header>
        <dl className="tf-detail-grid">
          {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
        <section className="tf-email-box">
          <h3>Email notifications</h3>
          <p>{EMAIL_STATUS_TEXT[lead.notificationStatus] || EMAIL_STATUS_TEXT.pending}</p>
          {lead.emailLog?.length > 0 && (
            <ul>
              {lead.emailLog.map((r) => (
                <li key={`${r.kind}-${r.to}`} className={r.status === "sent" ? "ok" : "bad"}>
                  <span>{r.kind === "customer" ? "Thank-you to customer" : "Team"}: {r.to}</span>
                  <b>{r.status === "sent" ? "Sent" : "Failed"}</b>
                </li>
              ))}
            </ul>
          )}
          {canResend && <button type="button" className="btn btn-outline" onClick={resend} disabled={resending}>{resending ? "Resending..." : "Resend failed emails"}</button>}
          {resendMsg && <p role="status" className="tf-resend-msg">{resendMsg}</p>}
        </section>
      </div>
    </div>
  );
}
