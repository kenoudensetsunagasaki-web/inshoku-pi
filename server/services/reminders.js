
// Shared by the daily in-process scheduler (server.js) and the manual/
// external-cron admin endpoint (routes/admin.js), so both call exactly
// the same logic instead of drifting apart over time.
const db = require("../db");
const { sendExpiryReminder } = require("./mailer");

const REMINDER_DAYS_BEFORE = parseInt(process.env.REMINDER_DAYS_BEFORE || "14", 10);

async function checkAndSendExpiryReminders() {
  const due = db.dueForExpiryReminder(REMINDER_DAYS_BEFORE);
  let sent = 0;
  for (const r of due) {
    try {
      const ok = await sendExpiryReminder({
        to: r.email,
        storeName: r.name,
        expiresAt: r.listing_expires_at,
      });
      if (ok) {
        db.markReminderSent(r.id);
        sent++;
      }
    } catch (err) {
      console.error("[reminder] failed for", r.id, err.message);
    }
  }
  return { checked: due.length, sent };
}

module.exports = { checkAndSendExpiryReminders, REMINDER_DAYS_BEFORE };
