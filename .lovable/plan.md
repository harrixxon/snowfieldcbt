# Admin password reset

No implementation work is required.

The app will keep the existing reset-link flow:
- The one-time admin sign-up on `/auth` hides itself once an admin exists.
- The "Forgot password?" link on `/auth` sends a Supabase password-reset email.
- The reset link points to `/reset-password`, where the admin sets a new password.
- No custom email domain or 6-digit code flow is added.
