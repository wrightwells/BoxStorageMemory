import { describe, expect, it } from "vitest";
import {
  createStudy,
  disabledFlags,
  parseFlags,
  selectVariant,
  selectAssignment,
  selectReferenceLayout,
} from "../src/uiExperiments";

describe("runtime UX experiment", () => {
  const enabled = { ...disabledFlags, enabled: true, rolloutPercentage: 50 };
  it("keeps assignments stable while rollout changes and supports explicit previews", () => {
    expect(selectVariant(enabled, null, 49, null)).toBe(
      "persistent-navigation",
    );
    expect(selectVariant(enabled, null, 50, null)).toBe("control");
    expect(
      selectVariant(
        { ...enabled, rolloutPercentage: 0 },
        "persistent-navigation",
        99,
        null,
      ),
    ).toBe("persistent-navigation");
    expect(selectVariant(enabled, "control", 99, "persistent-navigation")).toBe(
      "persistent-navigation",
    );
  });
  it("promotes approved navigation despite an old control assignment and retains explicit rollback", () => {
    expect(
      parseFlags({
        ...enabled,
        photoRecognition: {
          enabled: true,
          rolloutPercentage: 200,
          forceVariant: null,
        },
      }),
    ).toEqual(disabledFlags);
    const promoted = {
      ...enabled,
      baselineVariant: "persistent-navigation" as const,
    };
    expect(selectVariant(promoted, "control", 99, null)).toBe(
      "persistent-navigation",
    );
    expect(selectVariant(promoted, "control", 99, "control")).toBe("control");
    expect(
      selectVariant({ ...promoted, forceVariant: "control" }, null, 0, null),
    ).toBe("control");
    expect(
      parseFlags({
        ...enabled,
        searchContext: {
          enabled: true,
          rolloutPercentage: 200,
          forceVariant: null,
        },
      }),
    ).toEqual(disabledFlags);
  });
  it("supports independent A/B/n allocations without invalid distribution", () => {
    const choose = (bucket: number, saved: "A" | "B" | "C" | null = null) =>
      selectAssignment(
        "A",
        ["A", "B", "C"] as const,
        true,
        null,
        [
          { variant: "B", percentage: 20 },
          { variant: "C", percentage: 30 },
        ],
        saved,
        bucket,
        null,
      );
    expect(choose(0)).toBe("B");
    expect(choose(19)).toBe("B");
    expect(choose(20)).toBe("C");
    expect(choose(49)).toBe("C");
    expect(choose(50)).toBe("A");
    expect(choose(99, "B")).toBe("B");
    expect(
      selectAssignment(
        "A",
        ["A", "B"],
        true,
        null,
        [{ variant: "B", percentage: 101 }],
        null,
        0,
        null,
      ),
    ).toBe("A");
  });
  it("global rollback overrides saved and URL assignments", () => {
    expect(
      selectVariant(
        disabledFlags,
        "persistent-navigation",
        0,
        "persistent-navigation",
      ),
    ).toBe("control");
    expect(
      selectVariant(
        { ...enabled, forceVariant: "control" },
        "persistent-navigation",
        0,
        "persistent-navigation",
      ),
    ).toBe("control");
    for (const invalid of [
      null,
      {},
      { ...enabled, rolloutPercentage: 101 },
      { ...enabled, enabled: "true" },
    ])
      expect(parseFlags(invalid)).toEqual(disabledFlags);
  });
  it("records only opt-in fixed counters and clears on withdrawal", () => {
    const study = createStudy();
    study.startTask();
    study.record("navigation");
    expect(study.summary().counts).toEqual({});
    study.enable(true);
    study.startTask();
    study.record("navigation");
    study.finishTask(true);
    expect(study.summary().counts).toEqual({
      taskStarted: 1,
      navigation: 1,
      taskCompleted: 1,
    });
    expect(study.summary().taskMilliseconds).toHaveLength(1);
    study.enable(false);
    expect(study.summary()).toEqual({ counts: {}, taskMilliseconds: [] });
  });
});

describe("approved reference layout", () => {
  const flags = {
    enabled: true,
    rolloutPercentage: 0,
    forceVariant: null,
    baselineVariant: "reference-box" as const,
  };
  it("overrides old assignments while retaining explicit rollback", () => {
    expect(selectReferenceLayout(flags, "control", 99, null)).toBe(
      "reference-box",
    );
    expect(selectReferenceLayout(flags, "reference-box", 0, "control")).toBe(
      "control",
    );
    expect(
      selectReferenceLayout(
        { ...flags, forceVariant: "control" },
        null,
        0,
        null,
      ),
    ).toBe("control");
    expect(
      selectReferenceLayout(
        { ...flags, enabled: false },
        "reference-box",
        0,
        null,
      ),
    ).toBe("control");
  });
  it("rejects an invalid reference baseline", () => {
    expect(
      parseFlags({
        ...disabledFlags,
        referenceLayout: { ...flags, baselineVariant: "invalid" },
      }),
    ).toEqual(disabledFlags);
  });
});
