// Integration tests: real Express server + real MongoDB + real SMTP server (local stub).
// Run with a MongoDB available:  TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm test
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { startSmtpStub } from "./helpers/smtpStub.js";

const MONGO = process.env.TEST_MONGODB_URI;
const skip = MONGO ? false : "set TEST_MONGODB_URI (e.g. mongodb://127.0.0.1:27017) to run these tests";

const JWT_SECRET = "test-secret-test-secret-test-secret";
const TEAM = ["krish@alphaauron.com", "santhan@alphaauron.com", "tejaswi@alphaauron.com"];
const dbName = `tf_test_${Date.now()}`;
const adminHash = bcrypt.hashSync("Test-Password-123", 4);
const adminToken = () => jwt.sign({ role: "admin", username: "admin" }, JWT_SECRET, { expiresIn: "1h" });
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer(extraEnv = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ["src/server.js"], {
    env: {
      ...process.env, PORT: String(port), MONGODB_URI: `${MONGO}/${dbName}`, JWT_SECRET,
      ADMIN_USERNAME: "admin", ADMIN_PASSWORD_HASH: adminHash, FRONTEND_ORIGIN: "http://localhost:5173",
      NOTIFY_EMAILS: `${TEAM[0]},${TEAM[1]}`, EMPLOYEE_EMAIL: TEAM[2], MAIL_FROM: "Talent Forge <contact@alphaauron.com>",
      ...extraEnv
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const base = `http://127.0.0.1:${port}/api`;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/health`)).ok) break; } catch { /* not up yet */ }
    await sleep(150);
  }
  const call = (path, { method = "GET", body, token = adminToken() } = {}) =>
    fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
      .then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  return { call, base, log: () => log, stop: () => new Promise((r) => { child.once("exit", r); child.kill(); }) };
}

let n = 0;
const enquiry = (extra = {}) => { n += 1; return { name: `Customer ${n}`, email: `customer${n}@example.com`, phone: `98765${String(10000 + n)}`, category: "Full Stack Development", skills: "React", experience: "Fresher", goal: "Learn new skills", message: "Hello", consent: true, ...extra }; };

describe("notifications + emails (real server, MongoDB, SMTP)", { skip }, () => {
  let smtp, server, db;
  before(async () => {
    smtp = await startSmtpStub();
    server = await startServer({ SMTP_HOST: "127.0.0.1", SMTP_PORT: String(smtp.port), SMTP_SECURE: "false", SMTP_USER: "u", SMTP_PASS: "p" });
    await mongoose.connect(`${MONGO}/${dbName}`);
    db = mongoose.connection.db;
  });
  after(async () => {
    await server.stop(); await smtp.close();
    await db.dropDatabase(); await mongoose.disconnect();
  });

  test("a new enquiry creates exactly ONE persistent admin notification linked to its lead", async () => {
    const r = await server.call("/leads", { method: "POST", token: null, body: enquiry({ name: "Anita Rao", category: "Cybersecurity" }) });
    assert.equal(r.status, 201);
    const lead = await db.collection("leads").findOne({ referenceId: r.body.lead.referenceId });
    const notes = await db.collection("notifications").find({ lead: lead._id }).toArray();
    assert.equal(notes.length, 1);
    assert.equal(notes[0].message, "New enquiry received from Anita Rao");
    assert.equal(notes[0].referenceId, lead.referenceId);
    assert.equal(notes[0].category, "Cybersecurity");
    assert.equal(notes[0].read, false);
    assert.equal(new Date(notes[0].submittedAt).getTime(), new Date(lead.createdAt).getTime());
    // survives a "restart": fetched fresh through the API
    const list = await server.call("/notifications");
    const mine = list.body.notifications.find((x) => x.referenceId === lead.referenceId);
    assert.ok(mine);
    assert.equal(mine.leadId, String(lead._id));
  });

  test("notifications never contain the customer's email or phone", async () => {
    const e = enquiry();
    await server.call("/leads", { method: "POST", token: null, body: e });
    const list = await server.call("/notifications");
    const text = JSON.stringify(list.body);
    assert.ok(!text.includes(e.email) && !text.includes(e.phone));
  });

  test("duplicate notifications for the same enquiry are impossible (idempotent create + unique index)", async () => {
    const { createLeadNotification, Notification } = await import("../src/notifications.js");
    const lead = await db.collection("leads").findOne({});
    await db.collection("notifications").deleteMany({ lead: lead._id });
    const a = await createLeadNotification(lead);
    const b = await createLeadNotification(lead);
    const c = await Promise.all([createLeadNotification(lead), createLeadNotification(lead), createLeadNotification(lead)]);
    assert.equal(a.created, true);
    assert.equal(b.created, false);
    assert.equal(c.filter((x) => x.created).length, 0);
    assert.equal(await Notification.countDocuments({ lead: lead._id }), 1);
    await Notification.init();
    await assert.rejects(Notification.collection.insertOne({ lead: lead._id, referenceId: "x", customerName: "x", message: "x", submittedAt: new Date() }), /E11000/);
  });

  test("one enquiry sends 4 emails: the 3 team members + a thank-you to the customer, each separately", async () => {
    smtp.mails.length = 0;
    const e = enquiry({ name: "Ravi Kumar" });
    const r = await server.call("/leads", { method: "POST", token: null, body: e });
    assert.equal(r.status, 201);
    assert.equal(r.body.emailStatus, "sent");
    assert.equal(r.body.confirmationEmailSent, true);
    assert.equal(smtp.mails.length, 4);
    for (const m of smtp.mails) assert.equal(m.to.length, 1, "each message has a single recipient (no leaking of other addresses)");
    const recipients = smtp.mails.map((m) => m.to[0]).sort();
    assert.deepEqual(recipients, [...TEAM, e.email].sort());
    const teamMails = smtp.mails.filter((m) => TEAM.includes(m.to[0]));
    for (const m of teamMails) {
      assert.match(m.subject, new RegExp(r.body.lead.referenceId));
      assert.ok(m.raw.includes(r.body.lead.referenceId) && m.raw.includes("Ravi Kumar"));
      assert.ok(m.replyTo.includes(e.email));
    }
    const thanks = smtp.mails.find((m) => m.to[0] === e.email);
    assert.match(thanks.subject, /Thank You for Your Interest in Talent Forge/);
    assert.ok(thanks.raw.includes(r.body.lead.referenceId));
    for (const t of TEAM) assert.ok(!thanks.raw.includes(t), "customer email must not expose team addresses");
    const lead = await db.collection("leads").findOne({ referenceId: r.body.lead.referenceId });
    assert.equal(lead.notificationStatus, "sent");
    assert.equal(lead.emailLog.length, 4);
  });

  test("notification APIs require a valid admin JWT (missing, garbage, wrong secret, expired)", async () => {
    const expired = jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: -10 });
    const wrongSecret = jwt.sign({ role: "admin" }, "other-secret", { expiresIn: "1h" });
    for (const token of [null, "garbage", wrongSecret, expired]) {
      for (const [method, path] of [["GET", "/notifications"], ["PATCH", "/notifications/read-all"], ["DELETE", "/notifications/read"], ["PATCH", "/notifications/507f1f77bcf86cd799439011/read"]]) {
        const r = await server.call(path, { method, token });
        assert.equal(r.status, 401, `${method} ${path}`);
      }
    }
  });

  test("filters, unread count, mark one read, mark all read, clear read (leads are kept)", async () => {
    await db.collection("notifications").deleteMany({});
    await db.collection("leads").deleteMany({});
    for (let i = 0; i < 4; i++) await server.call("/leads", { method: "POST", token: null, body: enquiry() });
    let all = await server.call("/notifications");
    assert.equal(all.body.unreadCount, 4);
    assert.equal(all.body.notifications.length, 4);
    assert.ok(new Date(all.body.notifications[0].submittedAt) >= new Date(all.body.notifications[3].submittedAt), "newest first");

    const first = all.body.notifications[0];
    const one = await server.call(`/notifications/${first.id}/read`, { method: "PATCH" });
    assert.equal(one.status, 200);
    assert.equal(one.body.notification.read, true);
    const again = await server.call(`/notifications/${first.id}/read`, { method: "PATCH" });
    assert.equal(again.status, 200, "marking an already-read notification is fine");

    assert.equal((await server.call("/notifications?filter=unread")).body.notifications.length, 3);
    assert.equal((await server.call("/notifications?filter=read")).body.notifications.length, 1);
    assert.equal((await server.call("/notifications")).body.unreadCount, 3);

    assert.equal((await server.call("/notifications/not-an-id/read", { method: "PATCH" })).status, 404);
    assert.equal((await server.call("/notifications/507f1f77bcf86cd799439011/read", { method: "PATCH" })).status, 404);

    const ra = await server.call("/notifications/read-all", { method: "PATCH" });
    assert.equal(ra.body.updated, 3);
    assert.equal((await server.call("/notifications")).body.unreadCount, 0);

    const cleared = await server.call("/notifications/read", { method: "DELETE" });
    assert.equal(cleared.body.deleted, 4);
    assert.equal((await server.call("/notifications")).body.total, 0);
    assert.equal(await db.collection("leads").countDocuments({}), 4, "clearing notifications must not delete enquiries");
  });

  test("clear-read only removes READ notifications", async () => {
    await db.collection("notifications").deleteMany({});
    await server.call("/leads", { method: "POST", token: null, body: enquiry() });
    await server.call("/leads", { method: "POST", token: null, body: enquiry() });
    const list = (await server.call("/notifications")).body.notifications;
    await server.call(`/notifications/${list[0].id}/read`, { method: "PATCH" });
    const r = await server.call("/notifications/read", { method: "DELETE" });
    assert.equal(r.body.deleted, 1);
    const after = await server.call("/notifications");
    assert.equal(after.body.total, 1);
    assert.equal(after.body.unreadCount, 1);
  });

  test("deleting a lead removes its notification, other notifications stay", async () => {
    await db.collection("notifications").deleteMany({});
    const a = await server.call("/leads", { method: "POST", token: null, body: enquiry() });
    await server.call("/leads", { method: "POST", token: null, body: enquiry() });
    const lead = await db.collection("leads").findOne({ referenceId: a.body.lead.referenceId });
    assert.equal((await server.call(`/leads/${lead._id}`, { method: "DELETE" })).status, 200);
    const list = await server.call("/notifications");
    assert.equal(list.body.total, 1);
    assert.ok(!list.body.notifications.some((x) => x.referenceId === a.body.lead.referenceId));
  });

  test("invalid enquiries are rejected with 400 and create no lead, notification or email", async () => {
    smtp.mails.length = 0;
    const before = [await db.collection("leads").countDocuments({}), await db.collection("notifications").countDocuments({})];
    for (const bad of [enquiry({ email: "not-an-email" }), enquiry({ email: "a@b.com\r\nBcc: x@y.com" }), enquiry({ phone: "123" }), enquiry({ consent: false }), enquiry({ name: "" })]) {
      const r = await server.call("/leads", { method: "POST", token: null, body: bad });
      assert.equal(r.status, 400);
    }
    assert.deepEqual([await db.collection("leads").countDocuments({}), await db.collection("notifications").countDocuments({})], before);
    assert.equal(smtp.mails.length, 0);
  });

  test("one team address rejected by SMTP -> status 'partial', others still delivered, then resend fixes only the failed one", async () => {
    smtp.mails.length = 0;
    smtp.reject.add(TEAM[1]);
    const e = enquiry();
    const r = await server.call("/leads", { method: "POST", token: null, body: e });
    assert.equal(r.status, 201);
    assert.equal(r.body.emailStatus, "partial");
    assert.deepEqual(smtp.mails.map((m) => m.to[0]).sort(), [TEAM[0], TEAM[2], e.email].sort());
    const lead = await db.collection("leads").findOne({ referenceId: r.body.lead.referenceId });
    assert.equal(lead.emailLog.find((x) => x.to === TEAM[1]).status, "failed");

    smtp.reject.clear(); smtp.mails.length = 0;
    const retry = await server.call(`/leads/${lead._id}/resend-emails`, { method: "POST" });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.emailStatus, "sent");
    assert.deepEqual(smtp.mails.map((m) => m.to[0]), [TEAM[1]], "only the failed recipient is retried (no duplicate emails)");
    const noMore = await server.call(`/leads/${lead._id}/resend-emails`, { method: "POST" });
    assert.match(noMore.body.message, /already sent/i);
    assert.equal(smtp.mails.length, 1);
  });
});

describe("failure modes (real server)", { skip }, () => {
  test("SMTP server down: enquiry + notification are still saved, status 'failed', server keeps running", async () => {
    const dead = await freePort();
    const server = await startServer({ SMTP_HOST: "127.0.0.1", SMTP_PORT: String(dead), SMTP_USER: "u", SMTP_PASS: "p" });
    await mongoose.connect(`${MONGO}/${dbName}`);
    const db = mongoose.connection.db;
    try {
      const r = await server.call("/leads", { method: "POST", token: null, body: enquiry({ name: "Down Test" }) });
      assert.equal(r.status, 201);
      assert.equal(r.body.emailStatus, "failed");
      assert.equal(r.body.confirmationEmailSent, false);
      const lead = await db.collection("leads").findOne({ referenceId: r.body.lead.referenceId });
      assert.ok(lead, "lead persisted");
      assert.equal(await db.collection("notifications").countDocuments({ lead: lead._id }), 1, "bell notification still created");
      assert.equal(lead.emailLog.filter((x) => x.status === "failed").length, 4);
      assert.ok((await server.call("/health", { token: null })).status === 200, "server still healthy");
    } finally { await server.stop(); await mongoose.disconnect(); }
  });

  test("SMTP not configured: enquiry + notification saved, status 'not-configured'", async () => {
    const server = await startServer({ SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "" });
    await mongoose.connect(`${MONGO}/${dbName}`);
    const db = mongoose.connection.db;
    try {
      const r = await server.call("/leads", { method: "POST", token: null, body: enquiry() });
      assert.equal(r.status, 201);
      assert.equal(r.body.emailStatus, "not-configured");
      const lead = await db.collection("leads").findOne({ referenceId: r.body.lead.referenceId });
      assert.equal(await db.collection("notifications").countDocuments({ lead: lead._id }), 1);
      const retry = await server.call(`/leads/${lead._id}/resend-emails`, { method: "POST" });
      assert.equal(retry.status, 503);
    } finally { await server.stop(); await mongoose.disconnect(); }
  });

  test("public enquiry endpoint is rate limited (protects the 3 inboxes and third-party addresses)", async () => {
    const server = await startServer({ LEAD_RATE_LIMIT: "3", SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "" });
    try {
      const statuses = [];
      for (let i = 0; i < 5; i++) statuses.push((await server.call("/leads", { method: "POST", token: null, body: enquiry() })).status);
      assert.deepEqual(statuses, [201, 201, 201, 429, 429]);
      assert.equal((await server.call("/notifications")).status, 200, "admin polling is not affected by the enquiry limiter");
    } finally { await server.stop(); }
  });
});
