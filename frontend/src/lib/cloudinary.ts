/**
 * Transforms Cloudinary URLs to serve responsive, auto-formatted, and auto-compressed images.
 * This saves bandwidth and storage credits on the Cloudinary Free Tier (25 monthly credits),
 * while accelerating client rendering and reducing memory usage.
 */
export function getOptimizedImageUrl(
  url?: string | null,
  options?: {
    width?: number;
    height?: number;
    crop?: "limit" | "fill" | "thumb" | "fit";
    quality?: "auto" | number;
  }
): string {
  if (!url) return "";
  if (!url.includes("res.cloudinary.com")) return url;

  // Don't re-apply if already transformed
  if (url.includes("/image/upload/f_auto") || url.includes("/image/upload/w_")) {
    return url;
  }

  const width = options?.width ?? 400;
  const height = options?.height;
  const crop = options?.crop ?? "limit";
  const quality = options?.quality ?? "auto";

  const transformParts = [
    "f_auto",
    `q_${quality}`,
    `w_${width}`,
    height ? `h_${height}` : null,
    `c_${crop}`,
  ].filter(Boolean);

  const transforms = transformParts.join(",");

  if (url.includes("/image/upload/")) {
    return url.replace("/image/upload/", `/image/upload/${transforms}/`);
  }

  return url;
}
