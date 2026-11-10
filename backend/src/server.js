import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { sendLeadEmails, isValidEmail } from "./mailer.js";
import {
  Notification,
  createLeadNotification,
  notificationsRouter,
} from "./notifications.js";

const app = express();
const allowedOrigins = [
  "http://localhost:5177",
  "http://localhost:5173",
  "http://127.0.0.1:5177",
  "http://127.0.0.1:5173",
];

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(express.json({ limit: "30kb" }));
app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 10 }));
const leadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LEAD_RATE_LIMIT || 20),
  skipFailedRequests: true,
  handler: (_req, res) =>
    res
      .status(429)
      .json({
        message:
          "Too many enquiries from this connection. Please try again later.",
      }),
});

const leadSchema = new mongoose.Schema(
  {
    referenceId: { type: String, unique: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, required: true, match: /^\d{10}$/ },
    category: { type: String, required: true },
    skills: { type: String, required: true, maxlength: 500 },
    experience: { type: String, required: true },
    goal: { type: String, required: true },
    message: { type: String, default: "", maxlength: 3000 },
    consent: { type: Boolean, required: true },
    status: {
      type: String,
      enum: ["New", "Contacted", "Interested", "Converted", "Closed"],
      default: "New",
    },
    followUp: { type: String, default: "", maxlength: 3000 },
    createdAt: { type: Date, default: Date.now },
    leadSource: { type: String, default: "Talent Forge website" },
    notificationStatus: { type: String, default: "pending" }, // sent | partial | failed | not-configured | pending
    emailLog: [
      {
        _id: false,
        to: String,
        kind: String,
        status: String,
        error: String,
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);
const Lead = mongoose.model("Lead", leadSchema);

function auth(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  try {
    if (!token) throw new Error("Missing token");
    req.admin = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Please log in again." });
  }
}

app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    database:
      mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  }),
);

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!process.env.JWT_SECRET || !process.env.ADMIN_PASSWORD_HASH)
    return res
      .status(503)
      .json({
        message: "Admin credentials are not configured in backend .env.",
      });
  const validUser = username === process.env.ADMIN_USERNAME;
  const validPassword = await bcrypt.compare(
    String(password || ""),
    process.env.ADMIN_PASSWORD_HASH,
  );
  if (!validUser || !validPassword)
    return res.status(401).json({ message: "Incorrect username or password." });
  const token = jwt.sign({ role: "admin", username }, process.env.JWT_SECRET, {
    expiresIn: "8h",
  });
  res.json({ token });
});

app.post("/api/leads", leadLimiter, async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      category,
      skills,
      experience,
      goal,
      message,
      consent,
    } = req.body || {};
    if (
      ![name, email, phone, category, skills, experience, goal].every(
        (v) => typeof v === "string" && v.trim(),
      ) ||
      consent !== true
    )
      return res
        .status(400)
        .json({ message: "Please complete all required fields and consent." });
    if (!isValidEmail(email.trim()))
      return res
        .status(400)
        .json({ message: "Please enter a valid email address." });
    if (!/^\d{10}$/.test(phone.trim()))
      return res
        .status(400)
        .json({ message: "Mobile number must be exactly 10 digits." });
    if (
      name.trim().length > 120 ||
      skills.length > 500 ||
      category.length > 100 ||
      (typeof message === "string" && message.length > 3000)
    )
      return res
        .status(400)
        .json({ message: "One of the fields is too long." });

    const lead = await Lead.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      category,
      skills,
      experience,
      goal,
      message: typeof message === "string" ? message : "",
      consent,
      referenceId: `TF-${new Date().getUTCFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    });

    // 1) Admin bell notification (one per lead, enforced by a unique index). Never blocks the enquiry.
    await createLeadNotification(lead).catch((err) =>
      console.error("Notification create failed:", err.message),
    );

    // 2) Emails: 3 team members + thank-you to the customer. Lead is already saved, so failures never lose it.
    const mail = await sendLeadEmails(lead).catch((err) => ({
      summary: "failed",
      results: [
        { to: "-", kind: "system", status: "failed", error: err.message },
      ],
    }));
    lead.notificationStatus = mail.summary;
    lead.emailLog = mail.results.map((r) => ({ ...r, at: new Date() }));
    await lead.save();
    mail.results
      .filter((r) => r.status === "failed")
      .forEach((r) =>
        console.error(`Email to ${r.kind} ${r.to} failed: ${r.error}`),
      );

    const customerResult = mail.results.find((r) => r.kind === "customer");
    return res.status(201).json({
      message: "Enquiry saved.",
      lead: { referenceId: lead.referenceId },
      emailStatus: mail.summary,
      confirmationEmailSent: customerResult?.status === "sent",
    });
  } catch (err) {
    console.error("Create lead error:", err.message);
    return res
      .status(500)
      .json({ message: "Could not save the enquiry. Please try again." });
  }
});

app.get("/api/leads", auth, async (_req, res) => {
  const leads = await Lead.find().sort({ createdAt: -1 }).lean();
  res.json({ leads });
});
app.patch("/api/leads/:id", auth, async (req, res) => {
  const allowed = {};
  if (
    ["New", "Contacted", "Interested", "Converted", "Closed"].includes(
      req.body.status,
    )
  )
    allowed.status = req.body.status;
  if (typeof req.body.followUp === "string")
    allowed.followUp = req.body.followUp.slice(0, 3000);
  const lead = await Lead.findByIdAndUpdate(req.params.id, allowed, {
    new: true,
    runValidators: true,
  });
  if (!lead) return res.status(404).json({ message: "Lead not found." });
  res.json({ lead });
});
app.delete("/api/leads/:id", auth, async (req, res) => {
  const lead = await Lead.findByIdAndDelete(req.params.id);
  if (!lead) return res.status(404).json({ message: "Lead not found." });
  await Notification.deleteOne({ lead: lead._id }).catch(() => {});
  res.json({ deleted: true });
});

// Retry only the emails that failed (e.g. SMTP was down). Admin only.
app.post("/api/leads/:id/resend-emails", auth, async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: "Lead not found." });
    const failed = (lead.emailLog || [])
      .filter((r) => r.status !== "sent" && r.to && r.to !== "-")
      .map((r) => r.to);
    const wanted = failed.length
      ? failed
      : lead.notificationStatus === "sent"
        ? []
        : null; // null = send everything
    if (Array.isArray(wanted) && wanted.length === 0)
      return res.json({
        emailStatus: "sent",
        results: [],
        message: "All emails were already sent.",
      });
    const mail = await sendLeadEmails(lead, wanted);
    if (!mail.configured)
      return res
        .status(503)
        .json({ message: "SMTP is not configured on the server." });
    const kept = (lead.emailLog || []).filter(
      (r) => !mail.results.some((n) => n.to === r.to),
    );
    lead.emailLog = [
      ...kept,
      ...mail.results.map((r) => ({ ...r, at: new Date() })),
    ];
    const all = lead.emailLog;
    lead.notificationStatus = all.every((r) => r.status === "sent")
      ? "sent"
      : all.some((r) => r.status === "sent")
        ? "partial"
        : "failed";
    await lead.save();
    res.json({ emailStatus: lead.notificationStatus, results: mail.results });
  } catch (err) {
    console.error("Resend emails error:", err.message);
    res.status(500).json({ message: "Could not resend the emails." });
  }
});

app.use("/api/notifications", notificationsRouter(auth));

const port = Number(process.env.PORT || 4000);
await mongoose.connect(
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/talent_forge",
);
app.listen(port, () =>
  console.log(`Talent Forge API running on http://localhost:${port}`),
);
