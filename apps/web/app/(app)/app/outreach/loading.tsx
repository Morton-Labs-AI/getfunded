import { OutreachPageSkeleton } from "./skeletons";

/** Route-level fallback for every outreach page while its data streams in. */
export default function OutreachLoading() {
  return <OutreachPageSkeleton />;
}
