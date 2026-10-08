import { ProfileSkeleton } from "@/components/funder/profile-skeleton";
import { PageBody } from "@/components/workspace/page-header";
import { YoursSkeleton } from "@/components/workspace/skeletons";

export default function Loading() {
  return (
    <PageBody>
      <div className="flex flex-col gap-8">
        <ProfileSkeleton />
        <YoursSkeleton />
      </div>
    </PageBody>
  );
}
