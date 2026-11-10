import express from "express";
import mongoose from "mongoose";

// ---------------------------------------------------------------------------
// Admin notifications (the bell in the dashboard).
// One notification per enquiry: the unique index on `lead` makes duplicates impossible,
// even if the same enquiry is processed twice. Notifications hold only what the bell needs
// (name, Lead ID, category, time). Phone/email stay in the lead record behind the JWT.
// ---------------------------------------------------------------------------

const notificationSchema = new mongoose.Schema(
  {
    type: { type: String, default: "new_enquiry" },
    lead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      required: true,
      unique: true,
    },
    referenceId: { type: String, required: true },
    customerName: { type: String, required: true },
    category: { type: String, default: "" },
    message: { type: String, required: true },
    submittedAt: { type: Date, required: true },
    read: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);
notificationSchema.index({ submittedAt: -1 });

export const Notification = mongoose.model("Notification", notificationSchema);

/** Idempotent: creates the notification once per lead, returns { created } */
export async function createLeadNotification(lead) {
  const name = String(lead.name || "").slice(0, 120);
  const result = await Notification.updateOne(
    { lead: lead._id },
    {
      $setOnInsert: {
        type: "new_enquiry",
        lead: lead._id,
        referenceId: lead.referenceId,
        customerName: name,
        category: lead.category,
        message: `New enquiry received from ${name}`,
        submittedAt: lead.createdAt || new Date(),
        read: false,
      },
    },
    { upsert: true },
  );
  return { created: result.upsertedCount === 1 };
}

const toDto = (n) => ({
  id: String(n._id),
  leadId: String(n.lead),
  referenceId: n.referenceId,
  customerName: n.customerName,
  category: n.category,
  message: n.message,
  submittedAt: n.submittedAt,
  read: n.read,
  readAt: n.readAt,
});

const validId = (id) => mongoose.isValidObjectId(id);

/** `auth` is the existing JWT middleware from server.js; every route below is admin-only. */
export function notificationsRouter(auth) {
  const router = express.Router();
  router.use(auth);

  // GET /api/notifications?filter=all|unread|read&limit=50
  router.get("/", async (req, res) => {
    try {
      const filter = ["all", "unread", "read"].includes(req.query.filter)
        ? req.query.filter
        : "all";
      const limit = Math.min(
        Math.max(parseInt(req.query.limit, 10) || 50, 1),
        100,
      );
      const query =
        filter === "unread"
          ? { read: false }
          : filter === "read"
            ? { read: true }
            : {};
      const [items, unreadCount, total] = await Promise.all([
        Notification.find(query)
          .sort({ submittedAt: -1, _id: -1 })
          .limit(limit)
          .lean(),
        Notification.countDocuments({ read: false }),
        Notification.countDocuments({}),
      ]);
      res.set("Cache-Control", "no-store");
      res.json({ notifications: items.map(toDto), unreadCount, total });
    } catch (err) {
      console.error("List notifications error:", err.message);
      res.status(500).json({ message: "Could not load notifications." });
    }
  });

  // Static paths first so "read-all" / "read" are not treated as :id
  router.patch("/read-all", async (_req, res) => {
    try {
      const r = await Notification.updateMany(
        { read: false },
        { $set: { read: true, readAt: new Date() } },
      );
      res.json({ updated: r.modifiedCount });
    } catch (err) {
      console.error("Read-all error:", err.message);
      res.status(500).json({ message: "Could not update notifications." });
    }
  });

  // Removes only READ notifications. Lead records are never touched.
  router.delete("/read", async (_req, res) => {
    try {
      const r = await Notification.deleteMany({ read: true });
      res.json({ deleted: r.deletedCount });
    } catch (err) {
      console.error("Clear-read error:", err.message);
      res.status(500).json({ message: "Could not clear notifications." });
    }
  });

  router.patch("/:id/read", async (req, res) => {
    if (!validId(req.params.id))
      return res.status(404).json({ message: "Notification not found." });
    try {
      const n = await Notification.findOneAndUpdate(
        { _id: req.params.id, read: false },
        { $set: { read: true, readAt: new Date() } },
        { new: true },
      );
      if (n) return res.json({ notification: toDto(n) });
      const existing = await Notification.findById(req.params.id).lean(); // already read is fine
      if (!existing)
        return res.status(404).json({ message: "Notification not found." });
      res.json({ notification: toDto(existing) });
    } catch (err) {
      console.error("Mark-read error:", err.message);
      res.status(500).json({ message: "Could not update the notification." });
    }
  });

  return router;
}
