import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Test users configuration
const TEST_USERS = [
  {
    email: "admin@ddorganizer.test",
    password: "Test123456!",
    fullName: "张明（管理员）",
    role: "admin",
  },
  {
    email: "senior@ddorganizer.test",
    password: "Test123456!",
    fullName: "李婷（高级合伙人）",
    role: "senior_lawyer",
  },
  {
    email: "junior@ddorganizer.test",
    password: "Test123456!",
    fullName: "王健（律师）",
    role: "junior_lawyer",
  },
  {
    email: "assistant@ddorganizer.test",
    password: "Test123456!",
    fullName: "陈静（律师助理）",
    role: "assistant",
  },
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Create admin client with service role key
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const results: Array<{ email: string; status: string; error?: string }> = [];

    for (const user of TEST_USERS) {
      try {
        // Check if user already exists
        const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
        const existingUser = existingUsers?.users?.find(u => u.email === user.email);

        if (existingUser) {
          // Update password if user exists
          await supabaseAdmin.auth.admin.updateUserById(existingUser.id, {
            password: user.password,
          });
          
          // Update profile
          await supabaseAdmin.from("profiles").upsert({
            id: existingUser.id,
            email: user.email,
            full_name: user.fullName,
            role: user.role,
            organization: "测试律所",
          });

          results.push({ email: user.email, status: "updated" });
        } else {
          // Create new user
          const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
            email: user.email,
            password: user.password,
            email_confirm: true, // Auto-confirm email
            user_metadata: {
              full_name: user.fullName,
            },
          });

          if (createError) {
            results.push({ email: user.email, status: "error", error: createError.message });
            continue;
          }

          if (newUser?.user) {
            // Create profile
            await supabaseAdmin.from("profiles").upsert({
              id: newUser.user.id,
              email: user.email,
              full_name: user.fullName,
              role: user.role,
              organization: "测试律所",
            });

            results.push({ email: user.email, status: "created" });
          }
        }
      } catch (error) {
        results.push({ 
          email: user.email, 
          status: "error", 
          error: error instanceof Error ? error.message : "Unknown error" 
        });
      }
    }

    return new Response(
      JSON.stringify({ success: true, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
