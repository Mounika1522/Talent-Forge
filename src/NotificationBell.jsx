import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Bell, BellOff, CheckCheck, Inbox, RefreshCw, Trash2 } from "lucide-react";
import "./notifications.css";

const POLL_MS = 12000; // refresh every 12 seconds while the dashboard is open
const FILTERS = [["all", "All"], ["unread", "Unread"], ["read", "Read"]];

function timeAgo(value) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
}
const fullTime = (value) => new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

export default function NotificationBell({ apiBase, getToken, onOpenLead, onAuthExpired, onNewEnquiry }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ringing, setRinging] = useState(false);
  const [, tick] = useState(0);

  const rootRef = useRef(null);
  const bellRef = useRef(null);
  const requestId = useRef(0);
  const previousUnread = useRef(null);
  const loadedOnce = useRef(false);
  const callbacks = useRef({});
  callbacks.current = { onAuthExpired, onNewEnquiry, getToken };

  const request = useCallback(async (path, options = {}) => {
    const token = callbacks.current.getToken();
    if (!token) throw new Error("Not logged in");
    const response = await fetch(`${apiBase}${path}`, {
      ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` }
    });
    if (response.status === 401) {
      callbacks.current.onAuthExpired?.();
      throw new Error("SESSION_EXPIRED");
    }
    if (!response.ok) throw new Error("REQUEST_FAILED");
    return response.json();
  }, [apiBase]);

  const load = useCallback(async (activeFilter, { silent = false } = {}) => {
    const id = ++requestId.current;
    if (!silent && !loadedOnce.current) setStatus("loading");
    try {
      const data = await request(`/notifications?filter=${activeFilter}&limit=50`);
      if (id !== requestId.current) return; // a newer request replaced this one
      setItems(data.notifications);
      setUnread(data.unreadCount);
      setTotal(data.total);
      setStatus("ready");
      setError("");
      loadedOnce.current = true;
      if (previousUnread.current !== null && data.unreadCount > previousUnread.current) {
        setRinging(true);
        setTimeout(() => setRinging(false), 1500);
        callbacks.current.onNewEnquiry?.(); // lets the dashboard table pick up the new lead too
      }
      previousUnread.current = data.unreadCount;
    } catch (err) {
      if (id !== requestId.current || err.message === "SESSION_EXPIRED") return;
      setStatus("error");
      setError("Could not load notifications. Check that the server is running.");
    }
  }, [request]);

  // Initial load + whenever the filter changes
  useEffect(() => { load(filter); }, [filter, load]);

  // Automatic refresh: every 12 s while the tab is visible, plus immediately when the tab becomes visible again
  useEffect(() => {
    const poll = () => { if (document.visibilityState === "visible") load(filter, { silent: true }); };
    const timer = setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", poll);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", poll); };
  }, [filter, load]);

  // Keep "5 min ago" labels fresh while the panel is open
  useEffect(() => {
    if (!open) return undefined;
    const timer = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(timer);
  }, [open]);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") { setOpen(false); bellRef.current?.focus(); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    setActionError("");
    if (next) load(filter, { silent: true });
  }

  async function openNotification(n) {
    setActionError("");
    setOpen(false);
    if (!n.read) {
      setItems((old) => old.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnread((c) => Math.max(0, c - 1));
      previousUnread.current = Math.max(0, (previousUnread.current ?? 1) - 1);
      try { await request(`/notifications/${n.id}/read`, { method: "PATCH" }); }
      catch (err) { if (err.message !== "SESSION_EXPIRED") { setActionError("Could not mark this notification as read."); load(filter, { silent: true }); } }
      load(filter, { silent: true });
    }
    onOpenLead(n.leadId);
  }

  async function runAction(path, method) {
    setBusy(true); setActionError("");
    try { await request(path, { method }); await load(filter, { silent: true }); }
    catch (err) { if (err.message !== "SESSION_EXPIRED") setActionError("That did not work. Please try again."); }
    finally { setBusy(false); }
  }
  const markAll = () => runAction("/notifications/read-all", "PATCH");
  function clearRead() {
    if (window.confirm("Clear all read notifications? The enquiries themselves are not deleted.")) runAction("/notifications/read", "DELETE");
  }

  const readCount = Math.max(0, total - unread);
  const badge = unread > 99 ? "99+" : String(unread);
  const emptyCopy = {
    all: ["No notifications yet", "New enquiries will appear here as soon as someone submits the form."],
    unread: ["You're all caught up", "There are no unread notifications."],
    read: ["No read notifications", "Notifications you have opened will be listed here."]
  }[filter];

  return (
    <div className="tf-bell" ref={rootRef}>
      <button ref={bellRef} type="button" className={`tf-bell-btn${unread ? " has-unread" : ""}${ringing ? " ringing" : ""}`}
        onClick={toggle} aria-haspopup="dialog" aria-expanded={open} aria-controls="tf-notification-panel"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications, none unread"}>
        <Bell size={19} aria-hidden="true" />
        {unread > 0 && <span className="tf-badge" aria-hidden="true">{badge}</span>}
      </button>
      <span className="tf-sr" role="status" aria-live="polite">{unread ? `${unread} unread notifications` : "No unread notifications"}</span>

      {open && (
        <section id="tf-notification-panel" className="tf-panel" role="dialog" aria-label="Notifications">
          <header className="tf-panel-head">
            <h2>Notifications</h2>
            <span className="tf-count">{unread} unread</span>
          </header>

          <div className="tf-tabs" role="tablist" aria-label="Filter notifications">
            {FILTERS.map(([value, label]) => (
              <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>
            ))}
          </div>

          <div className="tf-actions">
            <button type="button" onClick={markAll} disabled={busy || unread === 0}><CheckCheck size={14} aria-hidden="true" /> Mark all as read</button>
            <button type="button" onClick={clearRead} disabled={busy || readCount === 0}><Trash2 size={14} aria-hidden="true" /> Clear read</button>
          </div>

          {(error || actionError) && (
            <div className="tf-error" role="alert">
              <AlertCircle size={16} aria-hidden="true" />
              <span>{actionError || error}</span>
              {error && !actionError && <button type="button" onClick={() => load(filter)}><RefreshCw size={13} aria-hidden="true" /> Retry</button>}
            </div>
          )}

          <div className="tf-list" aria-busy={status === "loading"}>
            {status === "loading" && <div className="tf-state"><span className="tf-spinner" aria-hidden="true" /><p>Loading notifications...</p></div>}
            {status !== "loading" && items.length === 0 && !error && (
              <div className="tf-state">
                <span className="tf-state-icon">{filter === "all" ? <Inbox size={22} aria-hidden="true" /> : <BellOff size={22} aria-hidden="true" />}</span>
                <h3>{emptyCopy[0]}</h3><p>{emptyCopy[1]}</p>
              </div>
            )}
            {status !== "loading" && items.length > 0 && (
              <ul>
                {items.map((n) => (
                  <li key={n.id}>
                    <button type="button" className={`tf-item${n.read ? "" : " unread"}`} onClick={() => openNotification(n)}>
                      <span className="tf-dot" aria-hidden="true" />
                      <span className="tf-item-body">
                        <b>{n.message}</b>
                        <small>{n.referenceId} · {n.category}</small>
                        <small><time dateTime={new Date(n.submittedAt).toISOString()}>{fullTime(n.submittedAt)}</time> · {timeAgo(n.submittedAt)}</small>
                      </span>
                      {!n.read && <span className="tf-sr">Unread</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
