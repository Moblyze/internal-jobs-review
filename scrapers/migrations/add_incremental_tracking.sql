-- Migration: Add incremental scraping support
-- Date: 2026-02-08
-- Description: Add fields to support efficient incremental scraping

-- Add listing_hash column for detecting when job listings change
-- This allows us to skip re-fetching full job details if listing metadata is unchanged
ALTER TABLE scraped_jobs ADD COLUMN listing_hash TEXT;

-- Add last_verified timestamp for tracking when we last confirmed a job is still active
ALTER TABLE scraped_jobs ADD COLUMN last_verified TIMESTAMP;

-- Create index on listing_hash for fast lookups
CREATE INDEX IF NOT EXISTS idx_listing_hash ON scraped_jobs(listing_hash);

-- Create index on company + status for efficient lifecycle queries
CREATE INDEX IF NOT EXISTS idx_company_status ON scraped_jobs(company, status);

-- Create index on last_verified for finding stale jobs
CREATE INDEX IF NOT EXISTS idx_last_verified ON scraped_jobs(last_verified);

-- Create scrape_history table for tracking scrape metrics
CREATE TABLE IF NOT EXISTS scrape_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company TEXT NOT NULL,
    scrape_type TEXT NOT NULL,  -- 'full' or 'incremental'
    scrape_start TIMESTAMP NOT NULL,
    scrape_end TIMESTAMP NOT NULL,
    duration_seconds REAL NOT NULL,
    jobs_checked INTEGER DEFAULT 0,
    jobs_new INTEGER DEFAULT 0,
    jobs_removed INTEGER DEFAULT 0,
    jobs_exported INTEGER DEFAULT 0,
    pages_checked INTEGER DEFAULT 0,
    success BOOLEAN DEFAULT 1,
    error_message TEXT
);

-- Create index on scrape_history for querying recent scrapes
CREATE INDEX IF NOT EXISTS idx_scrape_history_company ON scrape_history(company, scrape_start);
