import { pool } from "./pool.js";

export async function initDb() {
  await pool.query(`
    ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();
  `);

  await pool.query(`
    ALTER TABLE allocations
    ADD COLUMN IF NOT EXISTS completion_date DATE;
  `);

  await pool.query(`
    ALTER TABLE allocations
    ADD COLUMN IF NOT EXISTS monthly_expected_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
  `);

  await pool.query(`
    ALTER TABLE allocations
    ADD COLUMN IF NOT EXISTS initial_deposit_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
  `);

  await pool.query(`
    ALTER TABLE allocations
    ADD COLUMN IF NOT EXISTS reminder_7d_sent BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await pool.query(`
    ALTER TABLE allocations
    ADD COLUMN IF NOT EXISTS reminder_7d_sent_at TIMESTAMP;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS receipts (
      id SERIAL PRIMARY KEY,
      payment_id INTEGER NOT NULL UNIQUE REFERENCES payments(id) ON DELETE CASCADE,
      receipt_number TEXT NOT NULL UNIQUE,
      payload_json JSONB NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reminder_logs (
      id SERIAL PRIMARY KEY,
      allocation_id INTEGER REFERENCES allocations(id) ON DELETE SET NULL,
      client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
      channel TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp')),
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'sent',
      sent_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
}
