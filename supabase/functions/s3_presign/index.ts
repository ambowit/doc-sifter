import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

serve(() => new Response("deprecated", { status: 410 }));
