export function isPossibleDuplicate(
  domain: string | null | undefined,
  existingDomain: string | null | undefined,
  nameSimilarity: number,
) {
  const normalizedDomain = domain?.trim().toLowerCase() || null;
  const normalizedExisting = existingDomain?.trim().toLowerCase() || null;
  return (
    Boolean(
      normalizedDomain &&
      normalizedExisting &&
      normalizedDomain === normalizedExisting,
    ) || nameSimilarity >= 0.8
  );
}
