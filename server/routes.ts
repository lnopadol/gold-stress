import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { collectAllData } from "./dataCollector";
import type { SignalData } from "@shared/schema";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Get latest snapshot (cached data)
  app.get("/api/signals/latest", async (_req, res) => {
    try {
      const snapshot = storage.getLatestSnapshot();
      if (!snapshot) {
        return res.json({ data: null, message: "No data yet. Trigger a refresh." });
      }
      const data: SignalData = JSON.parse(snapshot.data);
      return res.json({ data, date: snapshot.date });
    } catch (err) {
      return res.status(500).json({ error: "Failed to fetch latest signals" });
    }
  });

  // Get history for charts (last N snapshots)
  app.get("/api/signals/history", async (_req, res) => {
    try {
      const limit = parseInt(String(_req.query.limit)) || 30;
      const snapshots = storage.getRecentSnapshots(limit);
      const history = snapshots.reverse().map(s => ({
        date: s.date,
        data: JSON.parse(s.data) as SignalData,
      }));
      return res.json({ history });
    } catch (err) {
      return res.status(500).json({ error: "Failed to fetch history" });
    }
  });

  // Trigger data refresh (called on page load or by cron)
  app.post("/api/signals/refresh", async (_req, res) => {
    try {
      const data = await collectAllData();
      const today = new Date().toISOString().split("T")[0];
      const snapshot = storage.upsertSnapshot({
        date: today,
        data: JSON.stringify(data),
      });
      return res.json({ success: true, data, date: today });
    } catch (err: any) {
      console.error("Refresh error:", err);
      return res.status(500).json({ error: err.message || "Failed to refresh data" });
    }
  });

  return httpServer;
}
