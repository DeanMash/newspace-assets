import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/auth.js";
import coreRoutes from "./routes/core.js";
import { requireAuth } from "./middleware/auth.js";
import { startReminderJob } from "./jobs.js";
import { initDb } from "./db/init.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "newspace-assets-api" });
});

app.use("/api/auth", authRoutes);
app.use("/api", requireAuth, coreRoutes);

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`API running on http://localhost:${PORT}`);
      startReminderJob();
    });
  })
  .catch((err) => {
    console.error("Database initialization failed:", err);
    process.exit(1);
  });
