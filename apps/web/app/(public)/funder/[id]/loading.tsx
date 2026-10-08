import { ProfileSkeleton } from "@/components/funder/profile-skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <ProfileSkeleton />
    </div>
  );
}
