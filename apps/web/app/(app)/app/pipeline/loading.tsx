import { PageBody } from "@/components/workspace/page-header";
import { PipelineSkeleton } from "@/components/workspace/skeletons";

export default function Loading() {
  return (
    <PageBody>
      <PipelineSkeleton />
    </PageBody>
  );
}
