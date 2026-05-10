import cron from "node-cron";
import dayjs from "dayjs";
import { pool } from "./db/pool.js";
import { sendEmailMessage, sendWhatsAppMessage } from "./services/messaging.js";

export function startReminderJob() {
  cron.schedule("*/1 * * * *", async () => {
    const now = dayjs();
    const q = await pool.query(
      "SELECT * FROM events WHERE is_notified = FALSE AND starts_at <= $1::timestamp",
      [now.add(60, "minute").toISOString()]
    );

    for (const event of q.rows) {
      const remindAt = dayjs(event.starts_at).subtract(event.remind_minutes_before, "minute");
      if (now.isAfter(remindAt)) {
        // In production this is where WhatsApp/email/push integrations go.
        console.log(`[Reminder] ${event.title} starts at ${event.starts_at}`);
        await pool.query("UPDATE events SET is_notified = TRUE WHERE id = $1", [event.id]);
      }
    }

    // Auto-reminder: 7 days before payment completion date.
    const dueQ = await pool.query(`
      SELECT
        al.id AS allocation_id,
        al.completion_date,
        al.reminder_7d_sent,
        c.id AS client_id,
        c.full_name,
        c.email,
        c.phone,
        c.allow_email,
        c.allow_whatsapp,
        a.title AS asset_title,
        a.total_value,
        COALESCE(SUM(p.amount),0) AS paid_amount
      FROM allocations al
      JOIN clients c ON c.id = al.client_id
      JOIN assets a ON a.id = al.asset_id
      LEFT JOIN payments p ON p.allocation_id = al.id
      WHERE al.completion_date IS NOT NULL
        AND al.reminder_7d_sent = FALSE
      GROUP BY al.id, c.id, a.id
    `);

    for (const row of dueQ.rows) {
      const dueDate = dayjs(row.completion_date);
      const daysLeft = dueDate.startOf("day").diff(now.startOf("day"), "day");
      const outstanding = Number(row.total_value || 0) - Number(row.paid_amount || 0);
      if (daysLeft === 7 && outstanding > 0) {
        const reminderMessage =
          `Dear ${row.full_name}, your payment for ${row.asset_title} is due in 7 days ` +
          `on ${dueDate.format("YYYY-MM-DD")}. Outstanding balance: $${outstanding.toFixed(2)}. ` +
          `Please make payment to avoid penalties.`;

        let sentAtLeastOne = false;
        if (row.allow_email && row.email) {
          try {
            await sendEmailMessage({ to: row.email, message: reminderMessage });
            await pool.query(
              `INSERT INTO reminder_logs (allocation_id, client_id, channel, message, status)
               VALUES ($1, $2, 'email', $3, 'sent')`,
              [row.allocation_id, row.client_id, reminderMessage]
            );
            sentAtLeastOne = true;
          } catch (err) {
            console.error("Email reminder failed:", err.message);
          }
        }
        if (row.allow_whatsapp && row.phone) {
          try {
            await sendWhatsAppMessage({ to: row.phone, message: reminderMessage });
            await pool.query(
              `INSERT INTO reminder_logs (allocation_id, client_id, channel, message, status)
               VALUES ($1, $2, 'whatsapp', $3, 'sent')`,
              [row.allocation_id, row.client_id, reminderMessage]
            );
            sentAtLeastOne = true;
          } catch (err) {
            console.error("WhatsApp reminder failed:", err.message);
          }
        }

        if (sentAtLeastOne) {
          await pool.query(
            "UPDATE allocations SET reminder_7d_sent = TRUE, reminder_7d_sent_at = NOW() WHERE id = $1",
            [row.allocation_id]
          );
        }
      }
    }
  });
}
