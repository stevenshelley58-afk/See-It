type ProductAssetLike = {
  preparedImageKey?: string | null;
  preparedImageUrl?: string | null;
  preparedProductImageVersion?: number | null;
};

function extractGcsKeyFromSignedUrl(urlString: string): string | null {
  try {
    const url = new URL(urlString);
    // GCS signed URLs commonly look like: https://storage.googleapis.com/<bucket>/<key>?X-Goog-...
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) {
      // Drop the bucket name; return the object key.
      return parts.slice(1).join("/");
    }
    return null;
  } catch {
    return null;
  }
}

export function selectPreparedImage(
  productAsset: ProductAssetLike | null | undefined
): { key: string; version?: number } | null {
  if (!productAsset) return null;

  const version = productAsset.preparedProductImageVersion ?? undefined;

  if (productAsset.preparedImageKey && typeof version === "number") {
    return { key: productAsset.preparedImageKey, version };
  }

  if (productAsset.preparedImageKey) {
    return { key: productAsset.preparedImageKey };
  }

  if (productAsset.preparedImageUrl) {
    const maybeKey = extractGcsKeyFromSignedUrl(productAsset.preparedImageUrl);
    if (maybeKey) return { key: maybeKey };
    return { key: productAsset.preparedImageUrl };
  }

  return null;
}

