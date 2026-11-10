import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  Download,
  LayoutDashboard,
  Menu,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  Users,
  X,
  Zap,
} from "lucide-react";
import "./App.css";
import NotificationBell from "./NotificationBell.jsx";
import LeadDetails from "./LeadDetails.jsx";

const employee = {
  name: "Tejaswi Aramreddy",
  role: "Talent Forge Employee",
  company: "Alpha Auron Private Limited",
  email: "tejaswi@alphaauron.com",
  linkedin: "https://www.linkedin.com/in/tejaswi-aramreddy-424303252/",
};

const categories = [
  "Full Stack Development",
  "Frontend Development",
  "Backend Development",
  "AI / Machine Learning",
  "Cybersecurity",
  "Cloud / DevOps",
  "QA Automation",
  "Data Analytics",
  "Data Engineering",
  "UI / UX Design",
  "Animation / VFX",
  "Digital Media",
  "Digital Marketing",
  "Other",
];

const statuses = ["New", "Contacted", "Interested", "Converted", "Closed"];
const emptyForm = {
  name: "",
  email: "",
  phone: "",
  category: "",
  skills: "",
  experience: "",
  goal: "",
  message: "",
  consent: false,
};

function loadLeads() {
  try {
    const value = JSON.parse(localStorage.getItem("tf-demo-leads") || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function App() {
  const [page, setPage] = useState(
    window.location.pathname.replace(/\/$/, "") === "/admin" ? "admin" : "home",
  );
  const [adminLoggedIn, setAdminLoggedIn] = useState(false);
  const [adminUsername, setAdminUsername] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [leads, setLeads] = useState([]);
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

  async function refreshLeads(token) {
    try {
      const response = await fetch(`${API_BASE}/leads`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401) {
        handleAuthExpired();
        return null;
      }
      if (!response.ok) throw new Error("Could not load leads");
      const data = await response.json();
      setLeads(data.leads || []);
      return data.leads || [];
    } catch {
      setLoginError(
        "Backend connection failed. Make sure the server is running.",
      );
      return null;
    }
  }

  // Login expired (or token rejected): go back to the login form with a clear message.
  function handleAuthExpired() {
    sessionStorage.removeItem("tf-admin-token");
    setAdminLoggedIn(false);
    setAdminPassword("");
    setLeads([]);
    setSelectedLeadId(null);
    setLoginError("Your session expired. Please log in again.");
  }

  // Opened from a notification: show that lead's details (reload the list first if the lead is new).
  async function openLead(leadId) {
    let known = leads.some((lead) => lead._id === leadId);
    if (!known) {
      const fresh = await refreshLeads(
        sessionStorage.getItem("tf-admin-token"),
      );
      known = Boolean(fresh && fresh.some((lead) => lead._id === leadId));
    }
    if (known) setSelectedLeadId(leadId);
    else window.alert("This enquiry no longer exists.");
  }

  async function resendEmails(lead) {
    try {
      const token = sessionStorage.getItem("tf-admin-token");
      const response = await fetch(
        `${API_BASE}/leads/${lead._id}/resend-emails`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } },
      );
      if (response.status === 401) {
        handleAuthExpired();
        return false;
      }
      if (!response.ok) return false;
      await refreshLeads(token);
      return true;
    } catch {
      return false;
    }
  }

  useEffect(() => {
    const token = sessionStorage.getItem("tf-admin-token");
    if (token) {
      setAdminLoggedIn(true);
      refreshLeads(token);
    }
  }, []);

  function go(next) {
    if (next === "admin") {
      window.history.pushState({}, "", "/admin");
    } else {
      window.history.pushState({}, "", "/");
    }
    setPage(next);
    setMenuOpen(false);
    setNotice("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateForm(event) {
    const { name, value, checked, type } = event.target;
    setForm((old) => ({
      ...old,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  async function submitForm(event) {
    event.preventDefault();
    if (submitting) return; // ignore double clicks
    setSubmitting(true);
    setNotice("");
    try {
      const response = await fetch(`${API_BASE}/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.message || "Unable to submit enquiry");
      setForm(emptyForm);
      setNotice(
        `Thank you! Your enquiry reference is ${data.lead.referenceId}.${data.confirmationEmailSent ? " A confirmation email is on its way to you." : ""}`,
      );
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setNotice(
        error.message || "Could not connect to the server. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function updateLead(id, field, value, save = true) {
    const token = sessionStorage.getItem("tf-admin-token");
    setLeads((old) =>
      old.map((lead) => (lead._id === id ? { ...lead, [field]: value } : lead)),
    );
    if (!save) return;
    try {
      const response = await fetch(`${API_BASE}/leads/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ [field]: value }),
      });
      if (response.status === 401) {
        handleAuthExpired();
        return;
      }
      if (!response.ok) throw new Error("Update failed");
    } catch {
      window.alert(
        "Could not save the change to the backend. Refresh and try again.",
      );
      refreshLeads(token);
    }
  }

  function exportCSV() {
    if (!leads.length) {
      window.alert("No leads to export yet. Submit a test enquiry first.");
      return;
    }
    const fields = [
      "name",
      "email",
      "phone",
      "category",
      "skills",
      "experience",
      "goal",
      "message",
      "status",
      "followUp",
      "createdAt",
    ];
    const cell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csv = [
      fields.join(","),
      ...leads.map((lead) =>
        fields.map((field) => cell(lead[field])).join(","),
      ),
    ].join("\r\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "talent-forge-leads.csv";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  const visibleLeads = useMemo(
    () =>
      leads.filter((lead) => {
        const term = search.toLowerCase();
        const matches = [lead.name, lead.email, lead.phone, lead.category]
          .join(" ")
          .toLowerCase()
          .includes(term);
        return (
          matches && (statusFilter === "All" || lead.status === statusFilter)
        );
      }),
    [leads, search, statusFilter],
  );

  const Header = () => (
    <header className="topbar">
      <button
        className="logo"
        onClick={() => go("home")}
        aria-label="Talent Forge home"
      >
        <span className="logo-mark">TF</span>
        <span className="logo-copy">
          <b>TALENT FORGE</b>
          <small>POWERED BY ALPHA AURON</small>
        </span>
      </button>
      <button
        className="mobile-menu"
        onClick={() => setMenuOpen(!menuOpen)}
        aria-label="Toggle navigation"
      >
        {menuOpen ? <X size={22} /> : <Menu size={22} />}
      </button>
      <nav className={menuOpen ? "nav-links open" : "nav-links"}>
        <button onClick={() => go("home")}>Home</button>
        <button onClick={() => go("programs")}>Programs</button>
        <button onClick={() => go("membership")}>Membership</button>
        <button onClick={() => go("enquiry")}>Enquiry</button>
      </nav>
    </header>
  );

  const EmployeeCard = () => (
    <article className="employee-card">
      <img
        className="employee-avatar"
        src="/tejaswi-profile.jpeg"
        alt="Tejaswi Aramreddy"
      />
      <div>
        <span className="eyebrow">YOUR CONTACT</span>
        <h3>{employee.name}</h3>
        <p>{employee.role}</p>
      </div>
      <div className="employee-details">
        <span>{employee.company}</span>
        <a href={`mailto:${employee.email}`}>{employee.email}</a>
        <a href={employee.linkedin} target="_blank" rel="noreferrer">
          LinkedIn profile <ArrowUpRight size={14} />
        </a>
      </div>
    </article>
  );

  return (
    <div className="app-shell">
      <Header />
      <main>
        {page === "home" && (
          <>
            <section className="hero">
              <div className="hero-copy">
                <div className="pill">
                  <Sparkles size={14} /> YOUR NEXT CHAPTER STARTS HERE
                </div>
                <h1>
                  Your Skills.
                  <br />
                  <span>Real Projects.</span>
                  <br />
                  Professional Growth.
                </h1>
                <p className="hero-description">
                  Explore your professional interests, discover project
                  opportunities, and take the next step in your learning journey
                  with Talent Forge.
                </p>
                <div className="hero-buttons">
                  <button
                    className="btn btn-primary"
                    onClick={() => go("enquiry")}
                  >
                    Start an enquiry <ArrowRight size={17} />
                  </button>
                  <button
                    className="btn btn-outline"
                    onClick={() => go("programs")}
                  >
                    Explore programs
                  </button>
                </div>
                <div className="hero-proof">
                  <div>
                    <span className="proof-icon">
                      <Target size={17} />
                    </span>
                    <span>
                      <b>Find your path</b>
                      <small>Explore career areas</small>
                    </span>
                  </div>
                  <div>
                    <span className="proof-icon">
                      <Zap size={17} />
                    </span>
                    <span>
                      <b>Build your skills</b>
                      <small>Plan your next step</small>
                    </span>
                  </div>
                </div>
              </div>
              <div
                className="hero-art"
                aria-label="Talent Forge professional growth illustration"
              >
                <div className="art-glow"></div>
                <div className="art-ring ring-a"></div>
                <div className="art-ring ring-b"></div>
                <div className="art-core">
                  <div className="art-core-mark">TF</div>
                  <b>Talent Forge</b>
                  <small>Learn · Build · Grow</small>
                </div>
                <div className="art-chip chip-top">
                  <span className="chip-dot"></span>
                  <div>
                    <b>Skill development</b>
                    <small>Keep learning</small>
                  </div>
                </div>
                <div className="art-chip chip-left">
                  <span className="chip-number">02</span>
                  <div>
                    <b>Real projects</b>
                    <small>Put skills to practice</small>
                  </div>
                </div>
                <div className="art-chip chip-right">
                  <span className="chip-number">03</span>
                  <div>
                    <b>Professional growth</b>
                    <small>Move with purpose</small>
                  </div>
                </div>
              </div>
            </section>
            <section className="trust-strip">
              <span>EXPLORE OPPORTUNITIES IN</span>
              <div>Development</div>
              <i></i>
              <div>Cloud & DevOps</div>
              <i></i>
              <div>Design</div>
              <i></i>
              <div>Digital & Data</div>
            </section>
            <section className="section-block">
              <div className="section-heading">
                <span className="eyebrow">A PATH THAT FITS YOU</span>
                <h2>
                  Make your next move <span>count.</span>
                </h2>
                <p>
                  Discover professional areas and explore opportunities that
                  align with your interests and goals.
                </p>
              </div>
              <div className="feature-grid">
                <article className="feature-card">
                  <span className="feature-icon">
                    <Target />
                  </span>
                  <span className="mini-label">01 / DISCOVER</span>
                  <h3>Find your direction</h3>
                  <p>
                    Explore different professional categories and identify the
                    areas that excite you.
                  </p>
                </article>
                <article className="feature-card">
                  <span className="feature-icon">
                    <Zap />
                  </span>
                  <span className="mini-label">02 / DEVELOP</span>
                  <h3>Build relevant skills</h3>
                  <p>
                    Understand learning paths and practical skills related to
                    your chosen field.
                  </p>
                </article>
                <article className="feature-card">
                  <span className="feature-icon">
                    <Users />
                  </span>
                  <span className="mini-label">03 / GROW</span>
                  <h3>Move forward</h3>
                  <p>
                    Share your goals and enquire about the available Talent
                    Forge membership options.
                  </p>
                </article>
              </div>
            </section>
            <section className="employee-section">
              <div className="employee-intro">
                <span className="eyebrow">HERE TO HELP</span>
                <h2>
                  Start a conversation.
                  <br />
                  <span>Explore your options.</span>
                </h2>
                <p>
                  Have questions? Use the contact details below or submit an
                  enquiry to start the conversation.
                </p>
                <button
                  className="btn btn-primary"
                  onClick={() => go("enquiry")}
                >
                  Contact us <ArrowRight size={16} />
                </button>
              </div>
              <EmployeeCard />
            </section>
            <section className="final-cta">
              <div className="cta-icon">
                <Sparkles />
              </div>
              <span className="eyebrow">YOUR FUTURE IS A JOURNEY</span>
              <h2>Ready to take the first step?</h2>
              <p>Tell us what you want to learn and where you want to go.</p>
              <button className="btn btn-light" onClick={() => go("enquiry")}>
                Submit an enquiry <ArrowRight size={16} />
              </button>
            </section>
          </>
        )}

        {page === "programs" && (
          <section className="page-container">
            <div className="page-heading">
              <span className="eyebrow">EXPLORE YOUR INTERESTS</span>
              <h1>
                Find your <span>professional path.</span>
              </h1>
              <p>
                Choose an area to begin your enquiry. You can share your skills
                and goals in the next step.
              </p>
            </div>
            <div className="category-grid">
              {categories.map((category, index) => (
                <button
                  className="category-card"
                  key={category}
                  onClick={() => {
                    setForm((old) => ({ ...old, category }));
                    go("enquiry");
                  }}
                >
                  <span className="category-index">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <b>{category}</b>
                  <span className="category-action">
                    Explore this area <ArrowUpRight size={15} />
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {page === "membership" && (
          <section className="page-container membership-page">
            <div className="page-heading">
              <span className="eyebrow">TALENT FORGE MEMBERSHIP</span>
              <h1>
                Explore membership <span>options.</span>
              </h1>
              <p>
                Review the official membership details, pricing, eligibility,
                and benefits on the Talent Forge website.
              </p>
            </div>
            <div className="membership-card">
              <div className="membership-icon">
                <ShieldCheck size={28} />
              </div>
              <h2>Official membership information</h2>
              <p>
                For accurate, up-to-date plan prices and benefits, visit the
                official Talent Forge membership page. This demo intentionally
                does not invent plan prices or payouts.
              </p>
              <a
                className="btn btn-primary"
                href="https://alphaauron.com/talent-forge"
                target="_blank"
                rel="noreferrer"
              >
                View official membership page <ArrowUpRight size={16} />
              </a>
              <button className="btn btn-outline" onClick={() => go("enquiry")}>
                Ask about membership
              </button>
            </div>
          </section>
        )}

        {page === "enquiry" && (
          <section className="enquiry-layout">
            <div className="enquiry-intro">
              <span className="eyebrow">LET'S CONNECT</span>
              <h1>
                Tell us about
                <br />
                <span>your goals.</span>
              </h1>
              <p>
                Share a few details so the Talent Forge team can review your
                enquiry.
              </p>
              <div className="contact-mini">
                <img
                  className="mini-avatar"
                  src="/tejaswi-profile.jpeg"
                  alt="Tejaswi Aramreddy"
                />
                <div>
                  <b>{employee.name}</b>
                  <span>{employee.role}</span>
                  <a href={`mailto:${employee.email}`}>{employee.email}</a>
                </div>
              </div>
              <div className="privacy-note">
                <ShieldCheck size={18} />
                <span>
                  <b>Demo privacy note</b>
                  <small>
                    Your enquiry is submitted to the Talent Forge server.
                  </small>
                </span>
              </div>
            </div>
            <form className="enquiry-form" onSubmit={submitForm}>
              <div className="form-top">
                <div>
                  <span className="eyebrow">MEMBERSHIP LEAD FORM</span>
                  <h2>Membership enquiry</h2>
                </div>
                <span className="required-note">* Required</span>
              </div>
              {notice && (
                <div className="success-banner" role="status">
                  <CheckCircle2 size={18} />
                  {notice}
                </div>
              )}
              <div className="form-grid">
                <label>
                  Full name *
                  <input
                    name="name"
                    value={form.name}
                    onChange={updateForm}
                    placeholder="Enter your full name"
                    autoComplete="name"
                    required
                  />
                </label>
                <label>
                  Email address *
                  <input
                    name="email"
                    type="email"
                    value={form.email}
                    onChange={updateForm}
                    placeholder="name@example.com"
                    autoComplete="email"
                    required
                  />
                </label>
                <label>
                  Mobile number *
                  <input
                    name="phone"
                    type="tel"
                    value={form.phone}
                    onChange={updateForm}
                    placeholder="10-digit mobile number"
                    pattern="[0-9]{10}"
                    maxLength={10}
                    title="Enter exactly 10 digits"
                    required
                  />
                </label>
                <label>
                  Professional category *
                  <span className="select-wrap">
                    <select
                      name="category"
                      value={form.category}
                      onChange={updateForm}
                      required
                    >
                      <option value="">Select a category</option>
                      {categories.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                    <ChevronDown size={16} />
                  </span>
                </label>
                <label>
                  Primary skills *
                  <input
                    name="skills"
                    value={form.skills}
                    onChange={updateForm}
                    placeholder="HTML, CSS, React..."
                    required
                  />
                </label>
                <label>
                  Experience level *
                  <span className="select-wrap">
                    <select
                      name="experience"
                      value={form.experience}
                      onChange={updateForm}
                      required
                    >
                      <option value="">Select experience</option>
                      <option>Student</option>
                      <option>Fresher</option>
                      <option>0–2 years</option>
                      <option>2–5 years</option>
                      <option>5+ years</option>
                    </select>
                    <ChevronDown size={16} />
                  </span>
                </label>
                <label className="field-wide">
                  Professional goal *
                  <span className="select-wrap">
                    <select
                      name="goal"
                      value={form.goal}
                      onChange={updateForm}
                      required
                    >
                      <option value="">Select your goal</option>
                      <option>Learn new skills</option>
                      <option>Build projects</option>
                      <option>Career development</option>
                      <option>Explore membership</option>
                      <option>Other</option>
                    </select>
                    <ChevronDown size={16} />
                  </span>
                </label>
                <label className="field-wide">
                  Additional message
                  <textarea
                    name="message"
                    value={form.message}
                    onChange={updateForm}
                    placeholder="Anything else you would like to share?"
                    rows="4"
                  />
                </label>
              </div>
              <label className="consent-line">
                <input
                  type="checkbox"
                  name="consent"
                  checked={form.consent}
                  onChange={updateForm}
                  required
                />
                <span>
                  I confirm that the information provided is accurate and agree
                  to submit this demo enquiry.
                </span>
              </label>
              <button
                className="btn btn-primary form-submit"
                type="submit"
                disabled={submitting}
              >
                {submitting ? (
                  "Sending..."
                ) : (
                  <>
                    Submit enquiry <ArrowRight size={17} />
                  </>
                )}
              </button>
            </form>
          </section>
        )}

        {page === "admin" && !adminLoggedIn && (
          <section className="admin-login-wrap">
            <form
              className="admin-login-card"
              onSubmit={async (event) => {
                event.preventDefault();
                setLoginError("");
                try {
                  const response = await fetch(`${API_BASE}/auth/login`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      username: adminUsername,
                      password: adminPassword,
                    }),
                  });
                  const data = await response.json();
                  if (!response.ok)
                    throw new Error(
                      data.message || "Incorrect username or password.",
                    );
                  sessionStorage.setItem("tf-admin-token", data.token);
                  setAdminLoggedIn(true);
                  refreshLeads(data.token);
                } catch (error) {
                  setLoginError(error.message || "Backend connection failed.");
                }
              }}
            >
              <span className="eyebrow">RESTRICTED AREA</span>
              <h1>Admin login</h1>
              <p>Sign in to access the enquiry dashboard.</p>
              <label>
                Username
                <input
                  value={adminUsername}
                  onChange={(e) => setAdminUsername(e.target.value)}
                  autoComplete="username"
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              {loginError && (
                <p className="login-error" role="alert">
                  {loginError}
                </p>
              )}
              <button className="btn btn-primary form-submit" type="submit">
                Login <ArrowRight size={16} />
              </button>
              <small>Use credentials configured by your administrator.</small>
            </form>
          </section>
        )}

        {page === "admin" && adminLoggedIn && (
          <section className="dashboard-page">
            <div className="dashboard-title-row">
              <div>
                <span className="eyebrow">ADMIN AREA</span>
                <h1>Lead dashboard</h1>
                <p>Search, review and update enquiries stored on the server.</p>
              </div>
              <div className="dashboard-actions">
                <NotificationBell
                  apiBase={API_BASE}
                  getToken={() => sessionStorage.getItem("tf-admin-token")}
                  onOpenLead={openLead}
                  onAuthExpired={handleAuthExpired}
                  onNewEnquiry={() =>
                    refreshLeads(sessionStorage.getItem("tf-admin-token"))
                  }
                />
                <button className="btn btn-outline" onClick={exportCSV}>
                  <Download size={16} /> Export CSV
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => go("enquiry")}
                >
                  + New enquiry
                </button>
                <button
                  className="btn btn-outline"
                  onClick={() => {
                    sessionStorage.removeItem("tf-admin-token");
                    setAdminLoggedIn(false);
                    setAdminPassword("");
                    setLeads([]);
                    go("home");
                  }}
                >
                  Logout
                </button>
              </div>
            </div>
            <div className="stats-grid">
              <div className="stat-box">
                <span>
                  <Users size={17} /> Total leads
                </span>
                <b>{leads.length}</b>
                <small>All saved enquiries</small>
              </div>
              <div className="stat-box">
                <span>
                  <Sparkles size={17} /> New leads
                </span>
                <b>{leads.filter((l) => l.status === "New").length}</b>
                <small>Awaiting contact</small>
              </div>
              <div className="stat-box">
                <span>
                  <Target size={17} /> Interested
                </span>
                <b>{leads.filter((l) => l.status === "Interested").length}</b>
                <small>Follow-up needed</small>
              </div>
              <div className="stat-box">
                <span>
                  <CheckCircle2 size={17} /> Converted
                </span>
                <b>{leads.filter((l) => l.status === "Converted").length}</b>
                <small>Marked as converted</small>
              </div>
            </div>
            <div className="leads-panel">
              <div className="leads-panel-head">
                <div>
                  <h2>Enquiries</h2>
                  <p>{visibleLeads.length} result(s)</p>
                </div>
                <div className="lead-filters">
                  <label className="search-box">
                    <Search size={16} />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search leads..."
                    />
                  </label>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    aria-label="Filter by status"
                  >
                    <option>All</option>
                    {statuses.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
              {visibleLeads.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">
                    <Users size={23} />
                  </div>
                  <h3>No enquiries found</h3>
                  <p>Submit a test enquiry or change your search/filter.</p>
                  <button
                    className="btn btn-primary"
                    onClick={() => go("enquiry")}
                  >
                    Create test enquiry <ArrowRight size={16} />
                  </button>
                </div>
              ) : (
                <div className="table-scroll">
                  <table className="leads-table">
                    <thead>
                      <tr>
                        <th>Lead details</th>
                        <th>Category</th>
                        <th>Date</th>
                        <th>Status</th>
                        <th>Follow-up notes</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleLeads.map((lead) => (
                        <tr key={lead._id}>
                          <td>
                            <b>{lead.name}</b>
                            <small>{lead.email}</small>
                            <small>{lead.phone}</small>
                          </td>
                          <td>{lead.category}</td>
                          <td>{lead.createdAt}</td>
                          <td>
                            <select
                              value={lead.status}
                              onChange={(e) =>
                                updateLead(lead._id, "status", e.target.value)
                              }
                              aria-label={`Status for ${lead.name}`}
                            >
                              {statuses.map((s) => (
                                <option key={s}>{s}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              className="note-input"
                              value={lead.followUp || ""}
                              onChange={(e) =>
                                updateLead(
                                  lead._id,
                                  "followUp",
                                  e.target.value,
                                  false,
                                )
                              }
                              onBlur={(e) =>
                                updateLead(lead._id, "followUp", e.target.value)
                              }
                              placeholder="Add follow-up..."
                              aria-label={`Follow-up for ${lead.name}`}
                            />
                          </td>
                          <td>
                            <button
                              className="icon-delete"
                              title="Delete lead"
                              aria-label={`Delete ${lead.name}`}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Delete enquiry from ${lead.name}?`,
                                  )
                                ) {
                                  const token =
                                    sessionStorage.getItem("tf-admin-token");
                                  fetch(`${API_BASE}/leads/${lead._id}`, {
                                    method: "DELETE",
                                    headers: {
                                      Authorization: `Bearer ${token}`,
                                    },
                                  })
                                    .then((r) => {
                                      if (!r.ok) throw new Error();
                                      setLeads((old) =>
                                        old.filter(
                                          (item) => item._id !== lead._id,
                                        ),
                                      );
                                    })
                                    .catch(() =>
                                      window.alert(
                                        "Could not delete this lead from the backend.",
                                      ),
                                    );
                                }
                              }}
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <p className="demo-disclaimer">
              <ShieldCheck size={15} /> Enquiries are stored in the configured
              database. Keep your admin credentials private.
            </p>
            {leads.find((lead) => lead._id === selectedLeadId) && (
              <LeadDetails
                lead={leads.find((lead) => lead._id === selectedLeadId)}
                onClose={() => setSelectedLeadId(null)}
                onResend={resendEmails}
              />
            )}
          </section>
        )}
      </main>
      <footer className="site-footer">
        <div className="footer-main">
          <button className="logo footer-logo" onClick={() => go("home")}>
            <span className="logo-mark">TF</span>
            <span className="logo-copy">
              <b>TALENT FORGE</b>
              <small>POWERED BY ALPHA AURON</small>
            </span>
          </button>
          <p>Your Skills. Real Projects. Professional Growth.</p>
          <div className="footer-nav">
            <button onClick={() => go("home")}>Home</button>
            <button onClick={() => go("programs")}>Programs</button>
            <button onClick={() => go("membership")}>Membership</button>
            <button onClick={() => go("enquiry")}>Enquiry</button>
            <a
              href="https://alphaauron.com/talent-forge"
              target="_blank"
              rel="noreferrer"
            >
              Official page <ArrowUpRight size={13} />
            </a>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} Alpha Auron Private Limited</span>
          <span>Talent Forge · Frontend demo</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
