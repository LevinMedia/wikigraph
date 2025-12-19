-- Fix: Add 'discovered' status to page_fetch table
-- Copy and paste this entire block into Supabase SQL Editor and run it

DO $$
DECLARE
    constraint_name text;
BEGIN
    -- Find and drop the old constraint
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = 'page_fetch'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
    LIMIT 1;
    
    IF constraint_name IS NOT NULL THEN
        EXECUTE 'ALTER TABLE page_fetch DROP CONSTRAINT ' || constraint_name;
        RAISE NOTICE 'Dropped constraint: %', constraint_name;
    END IF;
    
    -- Add the new constraint with 'discovered' status
    ALTER TABLE page_fetch
    ADD CONSTRAINT page_fetch_status_check 
    CHECK (status IN ('queued', 'running', 'done', 'error', 'paused', 'discovered'));
    
    RAISE NOTICE 'Added new constraint with discovered status';
END $$;


