import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://aquaspin-laundry-station.vercel.app",
]);

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://aquaspin-laundry-station.vercel.app",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
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

    const token = authHeader.replace("Bearer ", "");
    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser(token);

    if (userError || !user) {
      return json({ error: "Invalid session." }, 401, corsHeaders);
    }

    const { data: ownerProfile, error: ownerProfileError } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (ownerProfileError || ownerProfile?.role !== "owner") {
      return json({ error: "Only an owner can manage staff accounts." }, 403, corsHeaders);
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "").trim().toLowerCase();

    if (action === "list") {
      const [{ data: profiles, error: profilesError }, { data: usersPage, error: usersError }] = await Promise.all([
        admin.from("profiles").select("id,full_name,role,contact_phone,avatar_path,created_at").order("created_at"),
        admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      ]);

      if (profilesError || usersError) {
        return json({ error: profilesError?.message ?? usersError?.message ?? "Could not load staff accounts." }, 500, corsHeaders);
      }

      const emails = new Map((usersPage?.users ?? []).map((authUser) => [authUser.id, authUser.email ?? ""]));
      return json({
        accounts: (profiles ?? []).map((profile) => ({ ...profile, email: emails.get(profile.id) ?? "" })),
      }, 200, corsHeaders);
    }

    const targetId = String(body.user_id ?? "").trim();
    if (!targetId) {
      return json({ error: "A staff account is required." }, 400, corsHeaders);
    }

    const { data: targetProfile, error: targetProfileError } = await admin
      .from("profiles")
      .select("id,full_name,role")
      .eq("id", targetId)
      .maybeSingle();

    if (targetProfileError) {
      return json({ error: targetProfileError.message }, 500, corsHeaders);
    }

    if (!targetProfile) {
      return json({ error: "Staff account not found." }, 404, corsHeaders);
    }

    if (targetProfile.role !== "staff") {
      return json({ error: "Owner accounts cannot be edited or deleted here." }, 403, corsHeaders);
    }

    if (action === "delete") {
      const { error: deleteError } = await admin.auth.admin.deleteUser(targetId);
      if (deleteError) {
        return json({ error: `Could not delete the staff account: ${deleteError.message}` }, 409, corsHeaders);
      }
      return json({ deleted: true, user_id: targetId }, 200, corsHeaders);
    }

    if (action !== "update") {
      return json({ error: "Unsupported staff account action." }, 400, corsHeaders);
    }

    const fullName = String(body.full_name ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");

    if (!fullName || fullName.length > 120) {
      return json({ error: "Staff name is required and must be 120 characters or fewer." }, 400, corsHeaders);
    }

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return json({ error: "Enter a valid login email." }, 400, corsHeaders);
    }

    if (password && password.length < 8) {
      return json({ error: "Password must be at least 8 characters." }, 400, corsHeaders);
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

    if (email !== previousEmail.toLowerCase()) {
      authUpdates.email = email;
      authUpdates.email_confirm = true;
    }
    if (password) authUpdates.password = password;

    const { error: authUpdateError } = await admin.auth.admin.updateUserById(targetId, authUpdates);
    if (authUpdateError) {
      return json({ error: `Could not update the staff login: ${authUpdateError.message}` }, 400, corsHeaders);
    }

    const { error: profileUpdateError } = await authClient
      .from("profiles")
      .update({ full_name: fullName })
      .eq("id", targetId);

    if (profileUpdateError) {
      const rollback: Record<string, unknown> = {
        user_metadata: currentUser.user_metadata ?? {},
      };
      if (email !== previousEmail.toLowerCase() && previousEmail) {
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
      user: { id: targetId, email, full_name: fullName, role: "staff" },
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
