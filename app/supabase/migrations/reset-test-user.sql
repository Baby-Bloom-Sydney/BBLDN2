-- Reset test user: contact@babybloomlondon.co.uk
-- Run in Supabase SQL Editor

DO $$
DECLARE
  v_user_id UUID;
  v_nanny_id UUID;
BEGIN
  -- Find auth user
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'contact@babybloomlondon.co.uk';

  IF v_user_id IS NOT NULL THEN
    -- Find nanny record
    SELECT id INTO v_nanny_id FROM nannies WHERE user_id = v_user_id;

    IF v_nanny_id IS NOT NULL THEN
      DELETE FROM nanny_credentials WHERE nanny_id = v_nanny_id;
      DELETE FROM nanny_availability WHERE nanny_id = v_nanny_id;
      DELETE FROM nanny_images WHERE nanny_id = v_nanny_id;
      DELETE FROM nannies WHERE id = v_nanny_id;
    END IF;

    DELETE FROM form_snapshots WHERE user_id = v_user_id;
    DELETE FROM user_progress WHERE user_id = v_user_id;
    DELETE FROM user_roles WHERE user_id = v_user_id;
    DELETE FROM user_profiles WHERE user_id = v_user_id;
    DELETE FROM auth.users WHERE id = v_user_id;
  END IF;

  -- Reset the lead back to pre-conversion
  UPDATE nanny_leads
  SET lead_status = 'ai_generated',
      auth_user_id = NULL,
      converted_at = NULL,
      terms_accepted_at = NULL,
      funnel_step = 'N4'
  WHERE email = 'contact@babybloomlondon.co.uk';

  RAISE NOTICE 'Done. User deleted, lead reset to ai_generated.';
END $$;
