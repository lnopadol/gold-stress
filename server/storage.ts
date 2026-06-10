import { type Snapshot, type InsertSnapshot, snapshots } from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc } from "drizzle-orm";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

// Ensure schema exists (idempotent)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    data TEXT NOT NULL
  );
`);

export const db = drizzle(sqlite);

export interface IStorage {
  getLatestSnapshot(): Snapshot | undefined;
  getRecentSnapshots(limit: number): Snapshot[];
  upsertSnapshot(snapshot: InsertSnapshot): Snapshot;
}

export class DatabaseStorage implements IStorage {
  getLatestSnapshot(): Snapshot | undefined {
    return db.select().from(snapshots).orderBy(desc(snapshots.id)).limit(1).get();
  }

  getRecentSnapshots(limit: number): Snapshot[] {
    return db.select().from(snapshots).orderBy(desc(snapshots.id)).limit(limit).all();
  }

  upsertSnapshot(snapshot: InsertSnapshot): Snapshot {
    // Check if snapshot for this date exists
    const existing = db.select().from(snapshots).where(eq(snapshots.date, snapshot.date)).get();
    if (existing) {
      db.update(snapshots).set({ data: snapshot.data }).where(eq(snapshots.date, snapshot.date)).run();
      return db.select().from(snapshots).where(eq(snapshots.date, snapshot.date)).get()!;
    }
    return db.insert(snapshots).values(snapshot).returning().get();
  }
}

export const storage = new DatabaseStorage();
