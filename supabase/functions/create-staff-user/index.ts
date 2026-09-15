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

    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser(token);

    if (userError || !user) {
      return json({ error: "Invalid session." }, 401, corsHeaders);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profileError || profile?.role !== "owner") {
      return json({ error: "Only an owner can create staff accounts." }, 403, corsHeaders);
    }

    // Rate limit: a real owner creates staff accounts occasionally, not in
    // a loop. Caps runaway retries (a stuck button, a buggy script) well
    // above any legitimate rate, without needing anything from the client.
    const { data: withinLimit, error: rateLimitError } = await admin.rpc("check_rate_limit", {
      p_key: `create-staff-user:${user.id}`,
      p_max_count: 10,
      p_window_seconds: 3600,
    });

    if (rateLimitError) {
      return json({ error: "Could not verify request rate. Try again shortly." }, 500, corsHeaders);
    }

    if (!withinLimit) {
      return json(
        { error: "Too many staff accounts created recently. Please wait a bit and try again." },
        429,
        corsHeaders,
      );
    }

    const body = await req.json();
    const fullName = String(body.full_name ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");

    if (!fullName || !email || !password) {
      return json({ error: "Name, email, and password are required." }, 400, corsHeaders);
    }

    if (password.length < 8) {
      return json({ error: "Password must be at least 8 characters." }, 400, corsHeaders);
    }

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (error) {
      return json({ error: error.message }, 400, corsHeaders);
    }

    // Do not rely solely on the auth.users trigger. Explicitly ensure the
    // application profile exists so the new staff account is immediately
    // visible in Account Access and can create transactions under RLS.
    const { error: staffProfileError } = await admin.from("profiles").upsert(
      {
        id: data.user.id,
        full_name: fullName,
        role: "staff",
      },
      { onConflict: "id" },
    );

    if (staffProfileError) {
      // Keep Auth and application authorization consistent. If the profile
      // cannot be created, roll the Auth user back rather than leaving an
      // orphaned login that cannot operate correctly.
      await admin.auth.admin.deleteUser(data.user.id);
      return json({ error: `Could not create staff profile: ${staffProfileError.message}` }, 500, corsHeaders);
    }

    return json({
      user: {
        id: data.user.id,
        email: data.user.email,
        full_name: fullName,
        role: "staff",
      },
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
