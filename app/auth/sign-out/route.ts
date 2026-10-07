import { NextResponse, type NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";

/**
 * POST, not GET.
 *
 * A GET sign-out is CSRF-able by any <img> on any page, and — more mundanely
 * and more often — Next's own link prefetching will fire it just by hovering
 * the menu, signing the user out before they click anything. The account menu
 * therefore submits a form.
 */
export async function POST(request: NextRequest) {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
