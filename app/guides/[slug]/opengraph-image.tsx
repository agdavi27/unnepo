import { ImageResponse } from "next/og";
import { getGuide } from "@/lib/guides";

export const alt = "An Unnepo guide for college students";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 3600;

/** Each guide's share card: category, title and byline on the cream /guides background. */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = getGuide(slug);
  const title = guide?.title ?? "Student career guides";
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#F6F3EE", padding: "72px 80px", fontFamily: "Georgia, serif" }}>
        <div style={{ display: "flex", fontSize: 26, letterSpacing: 4, textTransform: "uppercase", color: "#3D6FD1", fontFamily: "sans-serif", fontWeight: 700 }}>
          {guide?.category ?? "Guides"}
        </div>
        <div style={{ display: "flex", fontSize: title.length > 60 ? 64 : 76, lineHeight: 1.08, color: "#1B1B1F", letterSpacing: -1.5 }}>{title}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: "sans-serif", fontSize: 28, color: "#6B665E" }}>
          <div style={{ display: "flex" }}>By Drew Davis · Colby College</div>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 800, color: "#1B1B1F", letterSpacing: -1 }}>
            unnepo<span style={{ color: "#3D8BFF" }}>.</span>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
