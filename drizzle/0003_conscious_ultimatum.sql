CREATE TABLE `adminLoginBuckets` (
	`keyHash` varchar(64) NOT NULL,
	`attempts` int NOT NULL DEFAULT 0,
	`windowStart` timestamp NOT NULL,
	CONSTRAINT `adminLoginBuckets_keyHash` PRIMARY KEY(`keyHash`)
);
--> statement-breakpoint
CREATE TABLE `panelSettings` (
	`id` int NOT NULL,
	`adminPort` int NOT NULL DEFAULT 8899,
	`listenAddress` varchar(64) NOT NULL DEFAULT '0.0.0.0',
	`managementPath` varchar(96) NOT NULL DEFAULT '/',
	`passwordHash` text,
	`passwordEncrypted` text,
	`authVersion` int NOT NULL DEFAULT 1,
	`revision` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `panelSettings_id` PRIMARY KEY(`id`)
);
