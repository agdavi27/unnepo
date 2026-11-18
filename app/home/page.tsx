import { AppHome } from "@/components/unnepo/app-home";
import { publishedGuides } from "@/lib/guides";

// Re-checked every hour, so the Resources tab lists each new guide.
export const revalidate = 3600;

/** The published guides, for the Resources tab. */
const guideLinks = () => publishedGuides().map(({ slug, title, description, category, readMinutes }) => ({ slug, title, description, category, readMinutes }));

export default function Page() {
  return <AppHome guides={guideLinks()} />;
}
