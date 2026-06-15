CREATE TABLE `media_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_name` text NOT NULL,
	`path` text NOT NULL,
	`duration_sec` real,
	`width` integer,
	`height` integer,
	`has_audio` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `render_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`file_name` text NOT NULL,
	`source_path` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`subtitle` text DEFAULT '' NOT NULL,
	`account` text NOT NULL,
	`category` text NOT NULL,
	`template_key` text NOT NULL,
	`output_path` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `render_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`status` text NOT NULL,
	`output_path` text,
	`message` text,
	`duration_ms` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `render_jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`config` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `templates_key_unique` ON `templates` (`key`);