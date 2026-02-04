-- Migration: Add 'pending_w9' to worker_payouts status enum
-- Date: 2026-01-28

-- First, find the enum type name (this will vary based on your database)
-- Common names: worker_payouts_status, payout_status, etc.

-- Check if status column uses an ENUM type
DO $$
DECLARE
    enum_type_name TEXT;
BEGIN
    -- Find the enum type used by worker_payouts.status
    SELECT pg_type.typname INTO enum_type_name
    FROM pg_type
    JOIN pg_attribute ON pg_attribute.atttypid = pg_type.oid
    JOIN pg_class ON pg_class.oid = pg_attribute.attrelid
    WHERE pg_class.relname = 'worker_payouts'
    AND pg_attribute.attname = 'status'
    AND pg_type.typtype = 'e'
    LIMIT 1;

    -- If enum type found, add the value
    IF enum_type_name IS NOT NULL THEN
        -- Check if value already exists
        IF NOT EXISTS (
            SELECT 1 FROM pg_enum 
            WHERE enumlabel = 'pending_w9' 
            AND enumtypid = (SELECT oid FROM pg_type WHERE typname = enum_type_name)
        ) THEN
            EXECUTE format('ALTER TYPE %I ADD VALUE ''pending_w9''', enum_type_name);
            RAISE NOTICE 'Added pending_w9 to enum type: %', enum_type_name;
        ELSE
            RAISE NOTICE 'pending_w9 already exists in enum type: %', enum_type_name;
        END IF;
    ELSE
        -- Status column is TEXT (not ENUM) - no action needed
        RAISE NOTICE 'Status column is TEXT type (not ENUM) - pending_w9 should work automatically';
    END IF;
END $$;
