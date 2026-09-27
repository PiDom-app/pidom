CREATE TABLE `documents_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`author` text,
	`page_count` integer,
	`byte_size` integer,
	`current_page` integer DEFAULT 1 NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`is_finished` integer DEFAULT false NOT NULL,
	`is_favorite` integer DEFAULT false NOT NULL,
	`is_synced` integer DEFAULT false NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `download_jobs` (
	`document_id` text PRIMARY KEY NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`received_bytes` integer DEFAULT 0 NOT NULL,
	`total_bytes` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `download_jobs_by_state` ON `download_jobs` (`state`);--> statement-breakpoint
CREATE TABLE `local_files` (
	`document_id` text PRIMARY KEY NOT NULL,
	`path` text,
	`hash` text,
	`bytes` integer,
	`version` text,
	`state` text DEFAULT 'queued' NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `local_files_by_state` ON `local_files` (`state`);