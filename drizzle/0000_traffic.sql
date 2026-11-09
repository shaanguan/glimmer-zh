CREATE TABLE `traffic_daily` (
	`day` text NOT NULL,
	`path` text NOT NULL,
	`referrer` text NOT NULL,
	`device` text NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	PRIMARY KEY(`day`, `path`, `referrer`, `device`),
	CONSTRAINT "traffic_daily_device_check" CHECK("traffic_daily"."device" IN ('mobile', 'tablet', 'desktop', 'unknown')),
	CONSTRAINT "traffic_daily_views_check" CHECK("traffic_daily"."views" >= 0)
);
--> statement-breakpoint
CREATE TABLE `traffic_receipts` (
	`event_id` text PRIMARY KEY NOT NULL,
	`received_at` integer NOT NULL,
	`day` text NOT NULL,
	`path` text NOT NULL,
	`referrer` text NOT NULL,
	`device` text NOT NULL,
	CONSTRAINT "traffic_receipts_device_check" CHECK("traffic_receipts"."device" IN ('mobile', 'tablet', 'desktop', 'unknown'))
);
--> statement-breakpoint
CREATE INDEX `traffic_receipts_received_at_idx` ON `traffic_receipts` (`received_at`);
--> statement-breakpoint
-- Keep receipt insertion and aggregation atomic. ON CONFLICT DO NOTHING for an
-- existing event_id does not fire this trigger, even across concurrent requests.
CREATE TRIGGER `traffic_receipts_aggregate`
AFTER INSERT ON `traffic_receipts`
BEGIN
  INSERT INTO `traffic_daily` (`day`, `path`, `referrer`, `device`, `views`, `first_seen_at`, `last_seen_at`)
  VALUES (NEW.`day`, NEW.`path`, NEW.`referrer`, NEW.`device`, 1, NEW.`received_at`, NEW.`received_at`)
  ON CONFLICT (`day`, `path`, `referrer`, `device`) DO UPDATE SET
    `views` = `traffic_daily`.`views` + 1,
    `first_seen_at` = MIN(`traffic_daily`.`first_seen_at`, excluded.`first_seen_at`),
    `last_seen_at` = MAX(`traffic_daily`.`last_seen_at`, excluded.`last_seen_at`);
END;
