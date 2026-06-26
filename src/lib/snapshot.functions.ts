import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

function getSb() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
}

export const createSnapshot = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      projectId: string;
      name: string;
      description?: string;
      overallScore?: number;
      payload: Record<string, unknown>;
    }) => input,
  )
  .handler(async ({ data }) => {
    const sb = getSb();
    const { data: row, error } = await sb
      .from("experiment_snapshots")
      .insert({
        project_id: data.projectId,
        name: data.name,
        description: data.description ?? null,
        overall_score: data.overallScore ?? null,
        payload: data.payload as never,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteSnapshot = createServerFn({ method: "POST" })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const sb = getSb();
    const { error } = await sb.from("experiment_snapshots").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
