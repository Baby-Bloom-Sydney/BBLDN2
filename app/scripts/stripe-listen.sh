#!/bin/sh
# Forward Stripe TEST-mode events to the local dev server's webhook route.
# London has no Connect (LDN2 unit 4f), so there is no --forward-connect-to.
# Refuses unless STRIPE_API_KEY is a test key; pass extra flags through
# (e.g. --events payment_intent.succeeded).

case "${STRIPE_API_KEY:-}" in
  sk_test_*|rk_test_*) ;;
  *) echo "stripe-listen: STRIPE_API_KEY must be a test key (sk_test_/rk_test_)" >&2; exit 1 ;;
esac

URL="${STRIPE_FORWARD_TO:-localhost:3000/api/webhooks/stripe}"

exec stripe listen --forward-to "$URL" "$@"
