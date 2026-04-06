-- Remove the Stripe payment method that can no longer be attached (Stripe error: "previously used without being attached or detached, may not be used again").
-- This was the old Acme card pm_1SxxfEAoeGfnj1xI9LTFoHdi; users should add a new card via SetupIntent.
DELETE FROM company_payment_methods
WHERE stripe_payment_method_id = 'pm_1SxxfEAoeGfnj1xI9LTFoHdi';
