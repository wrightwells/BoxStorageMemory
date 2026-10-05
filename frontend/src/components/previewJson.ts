/** Display a review copy without exposing internal box identifiers. */
export function previewJson(document: unknown): string {
  return JSON.stringify(
    document,
    (key, value) => {
      if (key === "boxId") return undefined;
      if (key === "box" && value && typeof value === "object") {
        return { ...value, id: undefined };
      }
      return value;
    },
    2,
  );
}
