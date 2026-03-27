import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getBearerToken } from "./worker-hmac.ts";

export interface ProjectAccessContext {
  userId: string;
  project: {
    id: string;
    user_id: string;
    name: string | null;
    target: string | null;
    client: string | null;
  };
}

export async function requireProjectAccess(
  req: Request,
  admin: ReturnType<typeof createClient>,
  projectId: string,
): Promise<ProjectAccessContext> {
  const token = getBearerToken(req);
  if (!token) {
    throw new Error("UNAUTHORIZED: 缺少访问令牌");
  }

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) {
    throw new Error("UNAUTHORIZED: 无效访问令牌");
  }

  const { data: project, error: projectError } = await admin
    .from("projects")
    .select("id, user_id, name, target, client")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError || !project) {
    throw new Error("NOT_FOUND: 项目不存在");
  }

  if (project.user_id !== userData.user.id) {
    throw new Error("FORBIDDEN: 无权访问该项目");
  }

  return {
    userId: userData.user.id,
    project,
  };
}
