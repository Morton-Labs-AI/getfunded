import { redirect } from "next/navigation";

/** /app/settings has no content of its own; Organization is the first tab. */
export default function SettingsIndexPage() {
  redirect("/app/settings/organization");
}
