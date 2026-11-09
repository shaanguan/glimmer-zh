import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

const devices = ["mobile", "tablet", "desktop", "unknown"] as const;

// Short-lived delivery receipts contain no visitor identifier. A new document
// generates a new random event ID; receipts are pruned in bounded request batches.
export const trafficReceipts = sqliteTable("traffic_receipts", {
  eventId: text("event_id").primaryKey().notNull(),
  receivedAt: integer("received_at").notNull(),
  day: text("day").notNull(),
  path: text("path").notNull(),
  referrer: text("referrer").notNull(),
  device: text("device", { enum: devices }).notNull(),
}, table => [
  index("traffic_receipts_received_at_idx").on(table.receivedAt),
  check("traffic_receipts_device_check", sql`${table.device} IN ('mobile', 'tablet', 'desktop', 'unknown')`),
]);

// The migration's AFTER INSERT trigger maintains these aggregates atomically.
// No request/session IDs or raw request headers are retained in daily totals.
export const trafficDaily = sqliteTable("traffic_daily", {
  day: text("day").notNull(),
  path: text("path").notNull(),
  referrer: text("referrer").notNull(),
  device: text("device", { enum: devices }).notNull(),
  views: integer("views").notNull().default(0),
  firstSeenAt: integer("first_seen_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
}, table => [
  primaryKey({ columns: [table.day, table.path, table.referrer, table.device] }),
  check("traffic_daily_device_check", sql`${table.device} IN ('mobile', 'tablet', 'desktop', 'unknown')`),
  check("traffic_daily_views_check", sql`${table.views} >= 0`),
]);
