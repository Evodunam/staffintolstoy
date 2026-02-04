-- Migration: Add stripe_identity_verification_id column to profiles table
-- This column stores the Stripe Identity verification session ID

-- Check if column exists before adding it
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'profiles' 
        AND column_name = 'stripe_identity_verification_id'
    ) THEN
        ALTER TABLE profiles 
        ADD COLUMN stripe_identity_verification_id TEXT;
        
        RAISE NOTICE 'Added stripe_identity_verification_id column to profiles table';
    ELSE
        RAISE NOTICE 'Column stripe_identity_verification_id already exists in profiles table';
    END IF;
END $$;
