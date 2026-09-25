-- ─────────────────────────────────────────────────────────────────────
-- Wipe a test parent by email (Supabase SQL Editor; requires service-role)
--
-- USE: edit `target_email` on the first DECLARE line, paste the whole
--      file into the Supabase SQL Editor, hit Run.
--
-- The script is wrapped in a single transaction. If anything errors,
-- the whole delete rolls back automatically — no partial-state risk.
--
-- The RAISE NOTICE lines surface the resolved user_id + parent_id +
-- nanny_positions before the deletes; check the output to confirm
-- you're wiping the row you intended.
--
-- Authored 2026-06-01 by parentOnboardFix300526 during the T-039 + T-040
-- + T-041 integration-branch smoke. The earlier short-lived
-- `delete-test-user.sql` (referenced in stash@{0} from feat/payments-
-- frontend-phase-a) is superseded by this one — wider table coverage,
-- transactional safety, explicit user-id/parent-id resolution log.
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

DO $$
DECLARE
  target_email   text := 'nannies@babybloomlondon.co.uk';  -- ← edit me
  v_user_id      uuid;
  v_parent_id    uuid;
  v_position_ids uuid[];
BEGIN
  -- 1. Resolve auth user
  SELECT id INTO v_user_id FROM auth.users WHERE email = target_email;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No auth.users row for email % — nothing to do', target_email;
  END IF;
  RAISE NOTICE 'auth.users.id = %', v_user_id;

  -- 2. Resolve parent (NULL if user is a nanny / admin / other role)
  SELECT id INTO v_parent_id FROM parents WHERE user_id = v_user_id;
  RAISE NOTICE 'parents.id    = %', v_parent_id;

  IF v_parent_id IS NOT NULL THEN
    SELECT array_agg(id) INTO v_position_ids
      FROM nanny_positions WHERE parent_id = v_parent_id;
    RAISE NOTICE 'nanny_positions = %', v_position_ids;

    -- Position-scoped + parent-scoped rows
    DELETE FROM connection_requests     WHERE parent_id   = v_parent_id;
    DELETE FROM dfy_match_notifications WHERE position_id = ANY(v_position_ids);
    DELETE FROM position_children       WHERE position_id = ANY(v_position_ids);
    DELETE FROM position_schedule       WHERE position_id = ANY(v_position_ids);
    DELETE FROM nanny_placements        WHERE parent_id   = v_parent_id;
    DELETE FROM nanny_positions         WHERE parent_id   = v_parent_id;
    DELETE FROM parents                 WHERE id          = v_parent_id;
  END IF;

  -- 3. User-scoped rows
  DELETE FROM parent_leads  WHERE converted_to_user_id = v_user_id;
  DELETE FROM inbox_messages WHERE user_id             = v_user_id;
  DELETE FROM viral_shares  WHERE user_id              = v_user_id;
  DELETE FROM user_roles    WHERE user_id              = v_user_id;
  DELETE FROM user_profiles WHERE user_id              = v_user_id;

  -- 4. Auth user last — Supabase ON DELETE CASCADE handles anything
  --    not enumerated above (chat_messages, bloombots, consent_records,
  --    payment_subscriptions, etc — all have FKs into auth.users with
  --    cascade by Supabase convention).
  DELETE FROM auth.users WHERE id = v_user_id;

  RAISE NOTICE '✓ Wiped % (user_id %, parent_id %)',
    target_email, v_user_id, v_parent_id;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- Verify afterwards (should return 0 rows):
--
--   SELECT id, email FROM auth.users
--   WHERE email = 'nannies@babybloomlondon.co.uk';
-- ─────────────────────────────────────────────────────────────────────
