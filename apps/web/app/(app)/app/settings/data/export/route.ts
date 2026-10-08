/**
 * GET /app/settings/data/export → a ZIP of the workspace's own data as JSON.
 * Signed-in owner or admin only. Streams nothing: the archive is built in
 * memory (rows are capped per table) and sent as a download.
 */
import { getUserOrNull } from "@/lib/auth/session";
import { withUser } from "@/lib/db/app";
import { jsonError } from "@/lib/security";
import { exportFilename, exportZip } from "@/lib/settings/export";
import { settingsErrorResponse } from "@/lib/settings/http";
import { canExportWorkspace } from "@/lib/settings/roles";
import { loadWorkspaceExport } from "@/lib/settings/service";
import { requireWorkspace } from "@/lib/workspace/context";

export async function GET(): Promise<Response> {
  const signedIn = await getUserOrNull();
  if (!signedIn) return jsonError(401, "unauthorized", "Sign in to export a workspace.");
  const { user, workspace } = await requireWorkspace();
  if (!canExportWorkspace(workspace.role)) {
    return jsonError(403, "admin_required", "Only a workspace owner or admin can export the workspace.");
  }
  try {
    const data = await withUser(user.id, (sql) =>
      loadWorkspaceExport(sql, { workspaceId: workspace.id, exportedBy: { user_id: user.id, email: user.email } }),
    );
    const zip = exportZip(data);
    const filename = exportFilename(workspace.slug, new Date(data.exported_at));
    return new Response(zip, {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-length": String(zip.byteLength),
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    const res = settingsErrorResponse(error);
    if (res) return res;
    throw error;
  }
}
