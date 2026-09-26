CREATE TABLE `local_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
