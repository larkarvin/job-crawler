-- Run once: mysql -h 127.0.0.1 -u root api.remotejobs < setup.sql

CREATE TABLE IF NOT EXISTS raw_jobs (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source      VARCHAR(100)  NOT NULL,
  external_id VARCHAR(255)  NULL,
  title       VARCHAR(500)  NOT NULL,
  company     VARCHAR(255)  NOT NULL,
  location    VARCHAR(255)  NOT NULL,
  url         TEXT          NOT NULL,
  description LONGTEXT,
  tags        JSON,
  scraped_at  DATETIME      NOT NULL,
  hash        VARCHAR(40)   NOT NULL,
  created_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY  unique_hash    (hash),
  INDEX       idx_source     (source),
  INDEX       idx_scraped_at (scraped_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
