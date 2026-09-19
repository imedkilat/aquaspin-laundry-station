import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://aquaspin-laundry-station.vercel.app",
]);

// Keep in sync with create-staff-user and the browser forms.
const PASSWORD_MIN_LENGTH = 8;
// bcrypt (used by Supabase Auth) only considers the first 72 bytes and recent
// Auth versions reject anything longer, so refuse it up front with a clear message.
const PASSWORD_MAX_BYTES = 72;
// Roughly 100 years. Supabase Auth has no "banned forever" flag; the Owner
// re-enables the account by sending ban_duration "none".
const BAN_DURATION = "876000h";
const LIST_PAGE_SIZE = 1000;
const LIST_MAX_PAGES = 50;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://aquaspin-laundry-station.vercel.app",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return `Password must be ${PASSWORD_MAX_BYTES} bytes or fewer (about ${PASSWORD_MAX_BYTES} characters).`;
  }
  return null;
}

function statusForRpcError(code: string | undefined): number {
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (code === "22023") return 400;
  return 500;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Missing authorization." }, 401, corsHeaders);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ error: "Server configuration is incomplete." }, 500, corsHeaders);
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Match the proven create-staff-user validation path. The same client
    // retains the Owner JWT for the profile update below.
    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser();

    if (userError || !user) {
      return json({ error: "Invalid session." }, 401, corsHeaders);
    }

    // The caller must be an ACTIVE Owner right now. A JWT issued before an
    // account was demoted or disabled stays cryptographically valid, so the
    // profile row (not the token) is the source of truth.
    const { data: ownerProfile, error: ownerProfileError } = await admin
      .from("profiles")
      .select("role,is_active")
      .eq("id", user.id)
      .maybeSingle();

    if (ownerProfileError || ownerProfile?.role !== "owner" || ownerProfile?.is_active !== true) {
      return json({ error: "Only an owner can manage staff accounts." }, 403, corsHeaders);
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "").trim().toLowerCase();

    if (action === "list") {
      const { data: profiles, error: profilesError } = await admin
        .from("profiles")
        .select("id,full_name,role,contact_phone,avatar_path,created_at,is_active,disabled_at")
        .order("created_at");

      if (profilesError) {
        return json({ error: profilesError.message ?? "Could not load staff accounts." }, 500, corsHeaders);
      }

      // Email addresses live in Supabase Auth, not in profiles. If that lookup
      // fails the list is still returned (Account Access must keep working),
      // but the response says so explicitly so the UI can warn the Owner
      // instead of silently showing blank emails.
      const emails = new Map<string, string>();
      const blocked = new Map<string, boolean>();
      let emailLookup: "ok" | "unavailable" = "ok";
      // Page until an EMPTY page rather than trusting that a short page is the
      // last one: the Auth server may cap per_page below what we ask for.
      // Hitting the page ceiling means the lookup is incomplete, so say so.
      let reachedEnd = false;
      for (let page = 1; page <= LIST_MAX_PAGES; page++) {
        const { data: usersPage, error: usersError } = await admin.auth.admin.listUsers({ page, perPage: LIST_PAGE_SIZE });
        if (usersError) break;
        const users = usersPage?.users ?? [];
        if (users.length === 0) {
          reachedEnd = true;
          break;
        }
        for (const authUser of users) {
          emails.set(authUser.id, authUser.email ?? "");
          const bannedUntil = (authUser as { banned_until?: string | null }).banned_until;
          blocked.set(authUser.id, Boolean(bannedUntil && Date.parse(bannedUntil) > Date.now()));
        }
      }
      if (!reachedEnd) {
        emailLookup = "unavailable";
        emails.clear();
        blocked.clear();
      }

      return json({
        email_lookup: emailLookup,
        accounts: (profiles ?? []).map((profile) => ({
          ...profile,
          email: emails.get(profile.id) ?? "",
          // null = unknown (lookup unavailable, or no Auth user found for this profile).
          sign_in_blocked: blocked.has(profile.id) ? blocked.get(profile.id) : null,
        })),
      }, 200, corsHeaders);
    }

    if (action === "delete") {
      return json({
        error: "Staff accounts are disabled, not deleted, so their transaction history stays intact. Use Disable Account instead.",
      }, 400, corsHeaders);
    }

    if (action !== "update" && action !== "disable" && action !== "enable") {
      return json({ error: "Unsupported staff account action." }, 400, corsHeaders);
    }

    const targetId = String(body.user_id ?? "").trim();
    if (!targetId) {
      return json({ error: "A staff account is required." }, 400, corsHeaders);
    }
    if (!UUID_PATTERN.test(targetId)) {
      return json({ error: "Staff account not found." }, 404, corsHeaders);
    }

    // Every action below re-checks the TARGET's role server-side, including
    // name-only edits, so an Owner account can never be changed through here.
    const { data: targetProfile, error: targetProfileError } = await admin
      .from("profiles")
      .select("id,full_name,role,is_active")
      .eq("id", targetId)
      .maybeSingle();

    if (targetProfileError) {
      return json({ error: targetProfileError.message }, 500, corsHeaders);
    }

    if (!targetProfile) {
      return json({ error: "Staff account not found." }, 404, corsHeaders);
    }

    if (targetId === user.id) {
      return json({ error: "You cannot change your own account here." }, 403, corsHeaders);
    }

    if (targetProfile.role !== "staff") {
      return json({ error: "Owner accounts cannot be edited, disabled or enabled here." }, 403, corsHeaders);
    }

    if (action === "disable") {
      // 1) Cut database/RLS access and delete every session first, so access is
      //    gone even if the Auth ban below fails (fail closed).
      const first = await admin.rpc("set_staff_account_active", { p_actor: user.id, p_target: targetId, p_active: false });
      if (first.error) {
        return json({ error: `Could not disable the account: ${first.error.message}` }, statusForRpcError(first.error.code), corsHeaders);
      }
      const firstRevoked = Number(first.data?.sessions_revoked ?? 0);

      // 2) Ban the login in Supabase Auth so a refresh token or password can no
      //    longer mint a new session.
      const { error: banError } = await admin.auth.admin.updateUserById(targetId, { ban_duration: BAN_DURATION });
      if (banError) {
        return json({
          error: `The account is disabled in the app and its sessions were revoked, but blocking the login in Supabase Auth failed: ${banError.message}. Press Disable Account again to retry.`,
          partial: true,
          app_access_disabled: true,
          sign_in_blocked: false,
          sessions_revoked: firstRevoked,
        }, 502, corsHeaders);
      }

      // 3) Sweep any session created in the short window before the ban landed.
      const sweep = await admin.rpc("set_staff_account_active", { p_actor: user.id, p_target: targetId, p_active: false });
      const sweepRevoked = sweep.error ? 0 : Number(sweep.data?.sessions_revoked ?? 0);

      return json({
        disabled: true,
        user_id: targetId,
        sign_in_blocked: true,
        sessions_revoked: firstRevoked + sweepRevoked,
        // "failed" only means the extra sweep did not run; the ban already stops new sessions.
        session_sweep: sweep.error ? "failed" : "ok",
      }, 200, corsHeaders);
    }

    if (action === "enable") {
      // Reverse order: unblock the login first. If the database step then
      // fails the account stays disabled in the app (fail closed).
      const { error: unbanError } = await admin.auth.admin.updateUserById(targetId, { ban_duration: "none" });
      if (unbanError) {
        return json({ error: `Could not re-enable the login in Supabase Auth: ${unbanError.message}. The account is still disabled.` }, 502, corsHeaders);
      }

      const enabled = await admin.rpc("set_staff_account_active", { p_actor: user.id, p_target: targetId, p_active: true });
      if (enabled.error) {
        return json({ error: `Could not enable the account: ${enabled.error.message}. The account is still disabled in the app.` }, statusForRpcError(enabled.error.code), corsHeaders);
      }

      return json({ enabled: true, user_id: targetId }, 200, corsHeaders);
    }

    const fullName = String(body.full_name ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");

    if (!fullName || fullName.length > 120) {
      return json({ error: "Staff name is required and must be 120 characters or fewer." }, 400, corsHeaders);
    }

    if (email && !/^\S+@\S+\.\S+$/.test(email)) {
      return json({ error: "Enter a valid login email." }, 400, corsHeaders);
    }

    if (password) {
      const problem = passwordProblem(password);
      if (problem) return json({ error: problem }, 400, corsHeaders);
    }

    const { data: authUserData, error: authUserError } = await admin.auth.admin.getUserById(targetId);
    if (authUserError || !authUserData.user) {
      return json({ error: authUserError?.message ?? "Staff login not found." }, 404, corsHeaders);
    }

    const currentUser = authUserData.user;
    const previousEmail = currentUser.email ?? "";
    const authUpdates: Record<string, unknown> = {
      user_metadata: { ...(currentUser.user_metadata ?? {}), full_name: fullName },
    };

    if (email && email !== previousEmail.toLowerCase()) {
      authUpdates.email = email;
      authUpdates.email_confirm = true;
    }
    if (password) authUpdates.password = password;

    const { error: authUpdateError } = await admin.auth.admin.updateUserById(targetId, authUpdates);
    if (authUpdateError) {
      return json({ error: `Could not update the staff login: ${authUpdateError.message}` }, 400, corsHeaders);
    }

    // A password reset must end the sessions that were opened with the old
    // password. A failure here is reported but does not undo the reset.
    let sessionsRevoked: number | null = null;
    if (password) {
      const revoked = await admin.rpc("revoke_staff_sessions", { p_actor: user.id, p_target: targetId });
      sessionsRevoked = revoked.error ? null : Number(revoked.data?.sessions_revoked ?? 0);
    }

    const { error: profileUpdateError } = await authClient
      .from("profiles")
      .update({ full_name: fullName })
      .eq("id", targetId);

    if (profileUpdateError) {
      const rollback: Record<string, unknown> = {
        user_metadata: currentUser.user_metadata ?? {},
      };
      if (email && email !== previousEmail.toLowerCase() && previousEmail) {
        rollback.email = previousEmail;
        rollback.email_confirm = true;
      }
      if (password) {
        // The previous password cannot be recovered, so report the profile
        // failure without claiming that the optional password was rolled back.
        return json({ error: `Profile name was not updated: ${profileUpdateError.message}. The login email/password update may have succeeded; verify the account before retrying.` }, 500, corsHeaders);
      }
      await admin.auth.admin.updateUserById(targetId, rollback);
      return json({ error: `Profile name was not updated: ${profileUpdateError.message}` }, 500, corsHeaders);
    }

    return json({
      updated: true,
      user: { id: targetId, email: email || previousEmail, full_name: fullName, role: "staff" },
      ...(password ? { sessions_revoked: sessionsRevoked, session_revoke_failed: sessionsRevoked === null } : {}),
    }, 200, corsHeaders);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return json({ error: message }, 500, corsHeaders);
  }
});

function json(body: unknown, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
