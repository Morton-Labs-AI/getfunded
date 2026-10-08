import { redirect } from "next/navigation";

/**
 * There is no separate sign-up: the sign-in form creates the account on first
 * use. The marketing header links to /signup, so this keeps that link honest.
 */
export default function SignUpPage() {
  redirect("/signin");
}
