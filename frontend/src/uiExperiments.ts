export type Variant = "control" | "persistent-navigation";
export interface Flags {
  photoRecognition?: {
    enabled: boolean;
    rolloutPercentage: number;
    forceVariant: "control" | "photo-recognition" | null;
  };
  referenceLayout?: {
    baselineVariant?: "control" | "reference-box";
    enabled: boolean;
    rolloutPercentage: number;
    forceVariant: "control" | "reference-box" | null;
  };
  baselineVariant?: Variant;
  searchContext?: {
    enabled: boolean;
    rolloutPercentage: number;
    forceVariant: "control" | "restore-search" | null;
  };
  experimentId: "NAV-001";
  enabled: boolean;
  rolloutPercentage: number;
  forceVariant: Variant | null;
  measurementEnabled: boolean;
}
export const disabledFlags: Flags = {
  experimentId: "NAV-001",
  enabled: false,
  rolloutPercentage: 0,
  forceVariant: null,
  measurementEnabled: false,
};
export function parseFlags(value: unknown): Flags {
  if (!value || typeof value !== "object") return disabledFlags;
  const flags = value as Flags;
  if (
    flags.experimentId !== "NAV-001" ||
    typeof flags.enabled !== "boolean" ||
    typeof flags.measurementEnabled !== "boolean" ||
    !Number.isInteger(flags.rolloutPercentage) ||
    flags.rolloutPercentage < 0 ||
    flags.rolloutPercentage > 100 ||
    ![null, "control", "persistent-navigation"].includes(flags.forceVariant)
  )
    return disabledFlags;
  if (
    flags.baselineVariant !== undefined &&
    !["control", "persistent-navigation"].includes(flags.baselineVariant)
  )
    return disabledFlags;
  if (flags.searchContext !== undefined) {
    const context = flags.searchContext;
    if (
      !context ||
      typeof context.enabled !== "boolean" ||
      !Number.isInteger(context.rolloutPercentage) ||
      context.rolloutPercentage < 0 ||
      context.rolloutPercentage > 100 ||
      ![null, "control", "restore-search"].includes(context.forceVariant)
    )
      return disabledFlags;
  }
  if (flags.photoRecognition !== undefined) {
    const photos = flags.photoRecognition;
    if (
      !photos ||
      typeof photos.enabled !== "boolean" ||
      !Number.isInteger(photos.rolloutPercentage) ||
      photos.rolloutPercentage < 0 ||
      photos.rolloutPercentage > 100 ||
      ![null, "control", "photo-recognition"].includes(photos.forceVariant)
    )
      return disabledFlags;
  }
  if (flags.referenceLayout !== undefined) {
    const layout = flags.referenceLayout;
    if (
      !layout ||
      (layout.baselineVariant !== undefined &&
        !["control", "reference-box"].includes(layout.baselineVariant)) ||
      typeof layout.enabled !== "boolean" ||
      !Number.isInteger(layout.rolloutPercentage) ||
      layout.rolloutPercentage < 0 ||
      layout.rolloutPercentage > 100 ||
      ![null, "control", "reference-box"].includes(layout.forceVariant)
    )
      return disabledFlags;
  }
  return flags;
}
export function selectReferenceLayout(
  flags: Flags["referenceLayout"],
  saved: "control" | "reference-box" | null,
  bucket: number,
  requested: string | null,
): "control" | "reference-box" {
  if (
    flags?.enabled &&
    flags.baselineVariant === "reference-box" &&
    !flags.forceVariant
  )
    return requested === "control" ? "control" : "reference-box";
  return selectAssignment(
    "control",
    ["control", "reference-box"],
    flags?.enabled ?? false,
    flags?.forceVariant ?? null,
    [{ variant: "reference-box", percentage: flags?.rolloutPercentage ?? 0 }],
    saved,
    bucket,
    requested,
  );
}
// Reusable A/B/n allocation: each independent experiment supplies its own variant names.
export function selectAssignment<V extends string>(
  control: V,
  variants: readonly V[],
  enabled: boolean,
  forced: V | null,
  allocations: ReadonlyArray<{ variant: V; percentage: number }>,
  saved: V | null,
  bucket: number,
  requested: string | null,
): V {
  if (!enabled) return control;
  if (forced !== null) return variants.includes(forced) ? forced : control;
  if (requested !== null && variants.includes(requested as V))
    return requested as V;
  if (saved !== null && variants.includes(saved)) return saved;
  if (
    !Number.isInteger(bucket) ||
    bucket < 0 ||
    bucket >= 100 ||
    allocations.some(
      ({ variant, percentage }) =>
        !variants.includes(variant) ||
        !Number.isInteger(percentage) ||
        percentage < 0,
    ) ||
    allocations.reduce((sum, { percentage }) => sum + percentage, 0) > 100
  )
    return control;
  let boundary = 0;
  for (const allocation of allocations) {
    boundary += allocation.percentage;
    if (bucket < boundary) return allocation.variant;
  }
  return control;
}
export function selectVariant(
  flags: Flags,
  saved: Variant | null,
  bucket: number,
  requested: string | null,
): Variant {
  if (
    flags.enabled &&
    flags.baselineVariant === "persistent-navigation" &&
    !flags.forceVariant
  ) {
    return requested === "control" ? "control" : "persistent-navigation";
  }
  return selectAssignment<Variant>(
    "control",
    ["control", "persistent-navigation"],
    flags.enabled,
    flags.forceVariant,
    [{ variant: "persistent-navigation", percentage: flags.rolloutPercentage }],
    saved,
    bucket,
    requested,
  );
}
// Deliberately aggregate only fixed event names. No URLs, text, IDs or account data.
export type StudyEvent =
  | "navigation"
  | "scroll"
  | "taskStarted"
  | "taskCompleted"
  | "taskFailed"
  | "queryChanged"
  | "resultOpened"
  | "contextRestored"
  | "thumbnailLoaded"
  | "thumbnailFailed"
  | "thumbnailOpened"
  | "boxTabChanged"
  | "addItemOpened"
  | "rowEditOpened";
export function createStudy() {
  let active = false;
  let started: number | null = null;
  let counts: Partial<Record<StudyEvent, number>> = {};
  let durations: number[] = [];
  return {
    enable(value: boolean) {
      active = value;
      if (!value) {
        started = null;
        counts = {};
        durations = [];
      }
    },
    record(event: StudyEvent) {
      if (
        !active ||
        ![
          "navigation",
          "scroll",
          "taskStarted",
          "taskCompleted",
          "taskFailed",
          "queryChanged",
          "resultOpened",
          "contextRestored",
          "thumbnailLoaded",
          "thumbnailFailed",
          "thumbnailOpened",
          "boxTabChanged",
          "addItemOpened",
          "rowEditOpened",
        ].includes(event)
      )
        return;
      counts[event] = (counts[event] ?? 0) + 1;
    },
    startTask() {
      if (active) {
        started = performance.now();
        this.record("taskStarted");
      }
    },
    finishTask(success: boolean) {
      if (!active || started === null) return;
      durations.push(Math.round(performance.now() - started));
      started = null;
      this.record(success ? "taskCompleted" : "taskFailed");
    },
    summary() {
      return { counts: { ...counts }, taskMilliseconds: [...durations] };
    },
    clear() {
      counts = {};
      durations = [];
      started = null;
    },
  };
}
