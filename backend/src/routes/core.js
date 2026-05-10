import express from "express";
import dayjs from "dayjs";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { sendEmailMessage, sendWhatsAppMessage } from "../services/messaging.js";

const router = express.Router();

async function buildAndStoreReceipt(paymentId) {
  const details = await pool.query(
    `
    SELECT
      p.id AS payment_id,
      p.amount,
      p.payment_date,
      p.created_at,
      p.method,
      p.reference,
      c.full_name AS client_name,
      c.phone AS client_phone,
      c.email AS client_email,
      a.title AS asset_title,
      a.location AS asset_location
    FROM payments p
    JOIN allocations al ON al.id = p.allocation_id
    JOIN clients c ON c.id = al.client_id
    JOIN assets a ON a.id = al.asset_id
    WHERE p.id = $1
  `,
    [paymentId]
  );

  const d = details.rows[0];
  if (!d) return null;

  const receiptNumber = `NSP-${String(paymentId).padStart(6, "0")}`;
  const receiptPayload = {
    company: {
      name: "New Space Properties (Pvt) Ltd",
      address: "4 Hellet Street, Masvingo, Zimbabwe",
      phone: "+263 781 806 042 / +263 713 643 153",
      email: "adminstration@newspaceproperties.com",
      logoPath: "/logo.jpeg",
    },
    receiptNumber,
    issuedAt: d.created_at,
    payment: d,
  };

  const receiptInsert = await pool.query(
    `
    INSERT INTO receipts (payment_id, receipt_number, payload_json)
    VALUES ($1, $2, $3::jsonb)
    ON CONFLICT (payment_id)
    DO UPDATE SET receipt_number = EXCLUDED.receipt_number, payload_json = EXCLUDED.payload_json
    RETURNING *
  `,
    [paymentId, receiptNumber, JSON.stringify(receiptPayload)]
  );

  return receiptInsert.rows[0];
}

function getPeriodConfig(period) {
  const now = dayjs();
  if (period === "weekly") {
    return {
      from: now.startOf("week"),
      bucketExpr: "to_char(payment_date, 'YYYY-MM-DD')",
      label: "day",
    };
  }
  if (period === "monthly") {
    return {
      from: now.startOf("month"),
      bucketExpr: "to_char(payment_date, 'YYYY-MM-DD')",
      label: "day",
    };
  }
  if (period === "annual") {
    return {
      from: now.startOf("year"),
      bucketExpr: "to_char(payment_date, 'YYYY-MM')",
      label: "month",
    };
  }
  return {
    from: now.startOf("day"),
    bucketExpr: "to_char(payment_date, 'YYYY-MM-DD')",
    label: "day",
  };
}

router.get("/clients", async (_req, res) => {
  const data = await pool.query("SELECT * FROM clients ORDER BY id DESC");
  res.json(data.rows);
});

router.patch("/clients/:id/consent", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid client id" });
  const schema = z.object({
    allowEmail: z.boolean().optional(),
    allowWhatsapp: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);
  const c = parsed.data;
  const q = await pool.query(
    `
      UPDATE clients
      SET allow_email = COALESCE($1, allow_email),
          allow_whatsapp = COALESCE($2, allow_whatsapp)
      WHERE id = $3
      RETURNING *
    `,
    [c.allowEmail, c.allowWhatsapp, id]
  );
  if (q.rowCount === 0) return res.status(404).json({ error: "Client not found" });
  res.json(q.rows[0]);
});

router.post("/clients", async (req, res) => {
  const schema = z.object({
    fullName: z.string().min(2),
    phone: z.string().optional().default(""),
    email: z.string().optional().default(""),
    address: z.string().optional().default(""),
    allowEmail: z.boolean().default(false),
    allowWhatsapp: z.boolean().default(false),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);
  const c = parsed.data;
  const q = await pool.query(
    `INSERT INTO clients (full_name,phone,email,address,allow_email,allow_whatsapp)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [c.fullName, c.phone, c.email, c.address, c.allowEmail, c.allowWhatsapp]
  );
  res.status(201).json(q.rows[0]);
});

router.get("/assets", async (_req, res) => {
  const q = await pool.query("SELECT * FROM assets ORDER BY id DESC");
  res.json(q.rows);
});

router.post("/assets", async (req, res) => {
  const schema = z.object({
    code: z.string().min(2),
    title: z.string().min(2),
    assetType: z.enum(["sale", "rental"]),
    location: z.string().optional().default(""),
    status: z.string().optional().default("available"),
    totalValue: z.coerce.number().nonnegative(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);
  const a = parsed.data;
  const q = await pool.query(
    `INSERT INTO assets (code,title,asset_type,location,total_value,status)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [a.code, a.title, a.assetType, a.location, a.totalValue, a.status]
  );
  res.status(201).json(q.rows[0]);
});

router.post("/allocations", async (req, res) => {
  const schema = z.object({
    clientId: z.coerce.number().int(),
    assetId: z.coerce.number().int(),
    startDate: z.string().optional(),
    completionDate: z.string().optional(),
    initialDepositAmount: z.coerce.number().nonnegative().optional().default(0),
    monthlyExpectedAmount: z.coerce.number().nonnegative().optional(),
    notes: z.string().optional().default(""),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);
  const a = parsed.data;

  const assetQ = await pool.query("SELECT total_value FROM assets WHERE id = $1", [a.assetId]);
  if (assetQ.rowCount === 0) return res.status(404).json({ error: "Asset not found" });
  const totalValue = Number(assetQ.rows[0].total_value || 0);
  const initialDeposit = Number(a.initialDepositAmount || 0);
  const start = dayjs(a.startDate ?? undefined);
  const finish = a.completionDate ? dayjs(a.completionDate) : null;
  let monthlyExpected = Number(a.monthlyExpectedAmount ?? 0);

  if (!monthlyExpected && finish && finish.isValid()) {
    const months = Math.max(1, finish.diff(start, "month", true));
    const remainder = Math.max(0, totalValue - initialDeposit);
    monthlyExpected = Number((remainder / months).toFixed(2));
  }

  const q = await pool.query(
    `INSERT INTO allocations (client_id,asset_id,start_date,completion_date,monthly_expected_amount,initial_deposit_amount,notes)
     VALUES ($1,$2,COALESCE($3::date,CURRENT_DATE),$4::date,$5,$6,$7) RETURNING *`,
    [
      a.clientId,
      a.assetId,
      a.startDate ?? null,
      a.completionDate ?? null,
      monthlyExpected,
      initialDeposit,
      a.notes,
    ]
  );
  res.status(201).json(q.rows[0]);
});

router.post("/payments", async (req, res) => {
  const schema = z.object({
    allocationId: z.coerce.number().int(),
    amount: z.coerce.number().positive(),
    paymentDate: z.string().optional(),
    method: z.string().optional().default("cash"),
    reference: z.string().optional().default(""),
    notes: z.string().optional().default(""),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);
  const p = parsed.data;
  const q = await pool.query(
    `INSERT INTO payments (allocation_id,amount,payment_date,method,reference,notes)
     VALUES ($1,$2,COALESCE($3::date,CURRENT_DATE),$4,$5,$6) RETURNING *`,
    [p.allocationId, p.amount, p.paymentDate ?? null, p.method, p.reference, p.notes]
  );
  const payment = q.rows[0];
  const receiptInsert = await buildAndStoreReceipt(payment.id);

  res.status(201).json({ payment, receipt: receiptInsert });
});

router.put("/payments/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid payment id" });

  const schema = z.object({
    amount: z.coerce.number().positive(),
    paymentDate: z.string().optional(),
    method: z.string().optional().default("cash"),
    reference: z.string().optional().default(""),
    notes: z.string().optional().default(""),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);
  const p = parsed.data;

  const q = await pool.query(
    `UPDATE payments
     SET amount = $1,
         payment_date = COALESCE($2::date, payment_date),
         method = $3,
         reference = $4,
         notes = $5
     WHERE id = $6
     RETURNING *`,
    [p.amount, p.paymentDate ?? null, p.method, p.reference, p.notes, id]
  );
  if (q.rowCount === 0) return res.status(404).json({ error: "Payment not found" });
  const receipt = await buildAndStoreReceipt(id);
  res.json({ payment: q.rows[0], receipt });
});

router.get("/payments", async (_req, res) => {
  const q = await pool.query(`
    SELECT
      p.id,
      p.allocation_id,
      p.amount,
      p.payment_date,
      p.created_at,
      p.method,
      p.reference,
      c.full_name AS client_name,
      a.title AS asset_title
    FROM payments p
    JOIN allocations al ON al.id = p.allocation_id
    JOIN clients c ON c.id = al.client_id
    JOIN assets a ON a.id = al.asset_id
    ORDER BY p.created_at DESC, p.id DESC
  `);
  res.json(q.rows);
});

router.get("/balances", async (_req, res) => {
  const q = await pool.query(`
    SELECT
      al.id AS allocation_id,
      c.id AS client_id,
      a.id AS asset_id,
      c.full_name AS client_name,
      a.title AS asset_title,
      a.asset_type,
      a.total_value,
      al.completion_date,
      al.monthly_expected_amount,
      al.initial_deposit_amount,
      COALESCE(SUM(p.amount),0) AS paid_amount,
      (a.total_value - COALESCE(SUM(p.amount),0)) AS outstanding_balance
    FROM allocations al
    JOIN clients c ON c.id = al.client_id
    JOIN assets a ON a.id = al.asset_id
    LEFT JOIN payments p ON p.allocation_id = al.id
    GROUP BY al.id, c.id, a.id, c.full_name, a.title, a.asset_type, a.total_value, al.completion_date, al.monthly_expected_amount, al.initial_deposit_amount
    ORDER BY al.id DESC
  `);
  res.json(q.rows);
});

router.delete("/clients/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid client id" });
  const q = await pool.query("DELETE FROM clients WHERE id = $1 RETURNING id", [id]);
  if (q.rowCount === 0) return res.status(404).json({ error: "Client not found" });
  res.json({ deletedClientId: q.rows[0].id });
});

router.delete("/assets/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid asset id" });
  const q = await pool.query("DELETE FROM assets WHERE id = $1 RETURNING id", [id]);
  if (q.rowCount === 0) return res.status(404).json({ error: "Asset not found" });
  res.json({ deletedAssetId: q.rows[0].id });
});

router.get("/payments/:id/receipt", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid payment id" });
  const q = await pool.query(
    "SELECT id, payment_id, receipt_number, payload_json, created_at FROM receipts WHERE payment_id = $1",
    [id]
  );
  if (q.rowCount === 0) return res.status(404).json({ error: "Receipt not found" });
  res.json(q.rows[0]);
});

router.get("/reports/summary", async (req, res) => {
  const period = req.query.period || "daily";
  const { from } = getPeriodConfig(period);

  const income = await pool.query(
    "SELECT COALESCE(SUM(amount),0)::numeric(12,2) AS total FROM payments WHERE payment_date >= $1::date",
    [from.format("YYYY-MM-DD")]
  );

  const outstanding = await pool.query(`
    SELECT COALESCE(SUM(a.total_value),0) - COALESCE(SUM(p.paid),0) AS outstanding
    FROM allocations al
    JOIN assets a ON a.id = al.asset_id
    LEFT JOIN (
      SELECT allocation_id, SUM(amount) AS paid
      FROM payments
      GROUP BY allocation_id
    ) p ON p.allocation_id = al.id
  `);

  res.json({
    period,
    from: from.format("YYYY-MM-DD"),
    collected: income.rows[0].total,
    outstanding: outstanding.rows[0].outstanding,
  });
});

router.get("/reports/timeline", async (req, res) => {
  const period = req.query.period || "daily";
  const { from, bucketExpr, label } = getPeriodConfig(period);

  const q = await pool.query(
    `
      SELECT ${bucketExpr} AS bucket, COALESCE(SUM(amount),0)::numeric(12,2) AS total
      FROM payments
      WHERE payment_date >= $1::date
      GROUP BY bucket
      ORDER BY bucket ASC
    `,
    [from.format("YYYY-MM-DD")]
  );

  res.json({
    period,
    bucketLabel: label,
    from: from.format("YYYY-MM-DD"),
    rows: q.rows,
  });
});

router.get("/reports/export.csv", async (req, res) => {
  const period = req.query.period || "daily";
  const { from } = getPeriodConfig(period);

  const q = await pool.query(
    `
      SELECT
        p.id,
        p.payment_date,
        p.amount,
        p.method,
        p.reference,
        c.full_name AS client_name,
        a.title AS asset_title,
        a.asset_type
      FROM payments p
      JOIN allocations al ON al.id = p.allocation_id
      JOIN clients c ON c.id = al.client_id
      JOIN assets a ON a.id = al.asset_id
      WHERE p.payment_date >= $1::date
      ORDER BY p.payment_date DESC, p.id DESC
    `,
    [from.format("YYYY-MM-DD")]
  );

  const header = [
    "payment_id",
    "payment_date",
    "amount",
    "method",
    "reference",
    "client_name",
    "asset_title",
    "asset_type",
  ];
  const lines = [header.join(",")];

  for (const row of q.rows) {
    const values = [
      row.id,
      row.payment_date,
      row.amount,
      row.method ?? "",
      row.reference ?? "",
      row.client_name,
      row.asset_title,
      row.asset_type,
    ].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`);
    lines.push(values.join(","));
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="newspace-${period}-report.csv"`
  );
  res.send(lines.join("\n"));
});

router.get("/events", async (_req, res) => {
  const q = await pool.query("SELECT * FROM events ORDER BY starts_at ASC");
  res.json(q.rows);
});

router.post("/events", async (req, res) => {
  const schema = z.object({
    title: z.string().min(2),
    details: z.string().optional().default(""),
    startsAt: z.string().datetime(),
    remindMinutesBefore: z.coerce.number().int().min(1).default(60),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);
  const e = parsed.data;
  const q = await pool.query(
    `INSERT INTO events (title,details,starts_at,remind_minutes_before)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [e.title, e.details, e.startsAt, e.remindMinutesBefore]
  );
  res.status(201).json(q.rows[0]);
});

router.get("/events/reminders/upcoming", async (req, res) => {
  const minutes = Number(req.query.minutes || 120);
  const q = await pool.query(
    `
      SELECT *
      FROM events
      WHERE starts_at BETWEEN NOW() AND (NOW() + ($1 || ' minutes')::interval)
      ORDER BY starts_at ASC
    `,
    [minutes]
  );
  res.json({ withinMinutes: minutes, events: q.rows });
});

router.get("/projects", async (_req, res) => {
  const q = await pool.query("SELECT * FROM projects ORDER BY id DESC");
  res.json(q.rows);
});

router.post("/projects", async (req, res) => {
  const schema = z.object({
    name: z.string().min(2),
    projectType: z.enum(["town_planning", "civil_engineering"]),
    clientName: z.string().optional().default(""),
    status: z.string().optional().default("active"),
    budget: z.coerce.number().optional(),
    summary: z.string().optional().default(""),
    criticalAnalysis: z.string().optional().default(""),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);
  const p = parsed.data;
  const q = await pool.query(
    `INSERT INTO projects (name,project_type,client_name,status,budget,summary,critical_analysis)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [p.name, p.projectType, p.clientName, p.status, p.budget ?? null, p.summary, p.criticalAnalysis]
  );
  res.status(201).json(q.rows[0]);
});

router.post("/projects/:id/analysis", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid project id" });
  const projectQ = await pool.query("SELECT * FROM projects WHERE id = $1", [id]);
  if (projectQ.rowCount === 0) return res.status(404).json({ error: "Project not found" });
  const p = projectQ.rows[0];

  const budget = Number(p.budget || 0);
  const status = String(p.status || "active").toLowerCase();
  let risk = "Medium";
  if (status.includes("completed")) risk = "Low";
  if (status.includes("delayed") || status.includes("stalled")) risk = "High";
  if (budget > 100000) risk = risk === "Low" ? "Medium" : "High";

  const analysis = [
    `Project Type: ${p.project_type.replace("_", " ")}`,
    `Status: ${p.status}`,
    `Budget: $${budget.toFixed(2)}`,
    `Risk Level: ${risk}`,
    `Recommendation: ${
      risk === "High"
        ? "Run weekly executive review, tighten milestones, and enforce cost controls."
        : risk === "Medium"
        ? "Track milestones closely and confirm stakeholder approvals early."
        : "Maintain current delivery pace and document closeout actions."
    }`,
  ].join(" ");

  const update = await pool.query(
    "UPDATE projects SET critical_analysis = $1 WHERE id = $2 RETURNING *",
    [analysis, id]
  );
  res.json(update.rows[0]);
});

router.post("/notifications/client/:id/send", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid client id" });
  const schema = z.object({
    channel: z.enum(["email", "whatsapp"]),
    message: z.string().min(2),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);
  const { channel, message } = parsed.data;

  const clientQ = await pool.query("SELECT * FROM clients WHERE id = $1", [id]);
  if (clientQ.rowCount === 0) return res.status(404).json({ error: "Client not found" });
  const client = clientQ.rows[0];

  if (channel === "email" && !client.allow_email) {
    return res.status(403).json({ error: "Client has not granted email permission" });
  }
  if (channel === "whatsapp" && !client.allow_whatsapp) {
    return res.status(403).json({ error: "Client has not granted WhatsApp permission" });
  }

  let providerResult = null;
  try {
    if (channel === "email") {
      if (!client.email) return res.status(400).json({ error: "Client email is missing" });
      providerResult = await sendEmailMessage({ to: client.email, message });
    } else {
      if (!client.phone) return res.status(400).json({ error: "Client phone is missing" });
      providerResult = await sendWhatsAppMessage({ to: client.phone, message });
    }
  } catch (err) {
    return res.status(500).json({
      error: `Failed to send ${channel} message`,
      details: err.message,
    });
  }

  res.json({
    sent: true,
    channel,
    clientId: client.id,
    clientName: client.full_name,
    message,
    providerResult,
    timestamp: new Date().toISOString(),
  });
});

router.get("/reminders/logs", async (_req, res) => {
  const q = await pool.query(`
    SELECT
      rl.id,
      rl.allocation_id,
      rl.client_id,
      c.full_name AS client_name,
      rl.channel,
      rl.message,
      rl.status,
      rl.sent_at
    FROM reminder_logs rl
    LEFT JOIN clients c ON c.id = rl.client_id
    ORDER BY rl.sent_at DESC, rl.id DESC
  `);
  res.json(q.rows);
});

export default router;
