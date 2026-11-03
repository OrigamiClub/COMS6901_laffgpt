import "server-only";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

// Ends a create/update/delete server action: back to `path` with a notice
// (see components/notice.tsx). Unique and foreign-key violations get their
// own messages; anything else is logged and reported as a failed save.
export function finish(
  path: string,
  error: { code?: string; message: string } | null,
  success: string
): never {
  if (error) {
    console.error(`Admin change on ${path} failed`, error);
    const notice =
      error.code === "23505" ? "duplicate" : error.code === "23503" ? "in-use" : "save-failed";
    redirect(`${path}?notice=${notice}`);
  }
  revalidatePath(path);
  redirect(`${path}?notice=${success}`);
}

// A trimmed form field, or "" when it's missing.
export function field(formData: FormData, name: string, max = 300) {
  return formData.get(name)?.toString().trim().slice(0, max) ?? "";
}

export function idField(formData: FormData) {
  const id = Number(formData.get("id"));
  return Number.isInteger(id) && id > 0 ? id : null;
}
