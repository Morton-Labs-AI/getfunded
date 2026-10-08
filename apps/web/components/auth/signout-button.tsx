import { Button, type buttonVariants } from "@/components/ui/button";
import type { VariantProps } from "class-variance-authority";

/**
 * A form that POSTs to /auth/signout. Works without JavaScript and is safe to
 * render in a Server Component. The route refuses GET and cross-origin POSTs.
 */
export function SignOutButton({
  children = "Sign out",
  variant = "ghost",
  size,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
} & VariantProps<typeof buttonVariants>) {
  return (
    <form action="/auth/signout" method="post" className="contents">
      <Button type="submit" variant={variant} size={size} className={className}>
        {children}
      </Button>
    </form>
  );
}
