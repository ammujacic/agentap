-- Migration: 0004_tunnel_infrastructure
-- Adds Cloudflare named tunnel support to machines and link request tracking

-- Add tunnel infrastructure columns to machines
ALTER TABLE machines ADD COLUMN tunnel_url TEXT;
ALTER TABLE machines ADD COLUMN cf_tunnel_id TEXT;
ALTER TABLE machines ADD COLUMN tunnel_token TEXT;

-- Add machine_id to link requests (marks request as claimed by linkMachine)
ALTER TABLE machine_link_requests ADD COLUMN machine_id TEXT;
