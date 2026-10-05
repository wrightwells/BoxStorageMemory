import { useEffect, useState } from "react";
import {
  createStudy,
  disabledFlags,
  parseFlags,
  selectVariant,
  selectAssignment,
  selectReferenceLayout,
  type Variant,
} from "../uiExperiments";

declare global {
  interface Window {
    boxStorageReferenceUx?: ReturnType<typeof createStudy>;
    boxStoragePhotoUx?: ReturnType<typeof createStudy>;
    boxStorageSearchUx?: ReturnType<typeof createStudy>;
    boxStorageUx?: ReturnType<typeof createStudy>;
  }
}
export function useNavigationExperiment() {
  const [variant, setVariant] = useState<Variant>("persistent-navigation");
  const [referenceLayout, setReferenceLayout] = useState(false);
  const [photoRecognition, setPhotoRecognition] = useState(false);
  const [restoreSearch, setRestoreSearch] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.uiVariant = "persistent-navigation";
    const study = createStudy();
    const contextStudy = createStudy();
    const photoStudy = createStudy();
    const referenceStudy = createStudy();
    let measuredLayout = "control";
    let layoutSaved: "control" | "reference-box" | null = null;
    try {
      const stored = sessionStorage.getItem("bsm:REF-001:variant");
      if (stored === "control" || stored === "reference-box")
        layoutSaved = stored;
    } catch {
      /* Memory fallback. */
    }
    let measuredPhotos = "control";
    let photoSaved: "control" | "photo-recognition" | null = null;
    try {
      const stored = sessionStorage.getItem("bsm:IMG-001:variant");
      if (stored === "control" || stored === "photo-recognition")
        photoSaved = stored;
    } catch {
      /* Memory fallback. */
    }
    let measuredContext = "control";
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("ui");
    let saved: Variant | null = null;
    let bucket = Math.floor(
      (crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32) * 100,
    );
    try {
      const stored = sessionStorage.getItem("bsm:NAV-001:variant");
      if (stored === "control" || stored === "persistent-navigation")
        saved = stored;
      const storedBucket = sessionStorage.getItem("bsm:NAV-001:bucket");
      if (storedBucket !== null && /^\d{1,2}$/.test(storedBucket))
        bucket = Number(storedBucket);
      sessionStorage.setItem("bsm:NAV-001:bucket", String(bucket));
    } catch {
      /* Blocked browser storage still supports a stable in-memory session. */
    }
    let contextSaved: "control" | "restore-search" | null = null;
    try {
      const stored = sessionStorage.getItem("bsm:CTX-001:variant");
      if (stored === "control" || stored === "restore-search")
        contextSaved = stored;
    } catch {
      /* Memory fallback. */
    }
    let measuredVariant: Variant = "control";
    let disposed = false;
    let controller: AbortController | null = null;
    async function refresh() {
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 5000);
      let flags = disabledFlags;
      try {
        const response = await fetch("/api/v1/ui-experiments", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.ok) flags = parseFlags(await response.json());
      } catch {
        /* Offline or invalid flags revert to the control. */
      } finally {
        window.clearTimeout(timeout);
      }
      if (disposed) return;
      const next = selectVariant(flags, saved, bucket, requested);
      const layoutFlags = flags.referenceLayout;
      const layoutVariant = selectReferenceLayout(
        layoutFlags,
        layoutSaved,
        (bucket + 13) % 100,
        params.get("layout"),
      );
      if (layoutFlags?.enabled && !layoutFlags.forceVariant) {
        layoutSaved = layoutVariant;
        try {
          sessionStorage.setItem("bsm:REF-001:variant", layoutVariant);
        } catch {
          /* Memory fallback. */
        }
      }
      if (layoutVariant !== measuredLayout) {
        referenceStudy.clear();
        measuredLayout = layoutVariant;
      }
      const measureLayout =
        !!layoutFlags?.enabled &&
        flags.measurementEnabled &&
        params.get("ux_measure") === "1";
      referenceStudy.enable(measureLayout);
      if (measureLayout) window.boxStorageReferenceUx = referenceStudy;
      else delete window.boxStorageReferenceUx;
      setReferenceLayout(layoutVariant === "reference-box");
      document.documentElement.dataset.referenceLayout = layoutVariant;
      const photoFlags = flags.photoRecognition;
      const photoVariant = selectAssignment<"control" | "photo-recognition">(
        "control",
        ["control", "photo-recognition"],
        photoFlags?.enabled ?? false,
        photoFlags?.forceVariant ?? null,
        [
          {
            variant: "photo-recognition",
            percentage: photoFlags?.rolloutPercentage ?? 0,
          },
        ],
        photoSaved,
        (bucket + 71) % 100,
        params.get("photos"),
      );
      if (photoFlags?.enabled && !photoFlags.forceVariant) {
        photoSaved = photoVariant;
        try {
          sessionStorage.setItem("bsm:IMG-001:variant", photoVariant);
        } catch {
          /* Memory fallback. */
        }
      }
      if (photoVariant !== measuredPhotos) {
        photoStudy.clear();
        measuredPhotos = photoVariant;
      }
      photoStudy.enable(
        !!photoFlags?.enabled &&
          flags.measurementEnabled &&
          params.get("ux_measure") === "1",
      );
      if (
        photoFlags?.enabled &&
        flags.measurementEnabled &&
        params.get("ux_measure") === "1"
      )
        window.boxStoragePhotoUx = photoStudy;
      else delete window.boxStoragePhotoUx;
      setPhotoRecognition(photoVariant === "photo-recognition");
      document.documentElement.dataset.photoRecognition = photoVariant;
      const context = flags.searchContext;
      const contextVariant = selectAssignment<"control" | "restore-search">(
        "control",
        ["control", "restore-search"],
        context?.enabled ?? false,
        context?.forceVariant ?? null,
        [
          {
            variant: "restore-search",
            percentage: context?.rolloutPercentage ?? 0,
          },
        ],
        contextSaved,
        (bucket + 37) % 100,
        params.get("context"),
      );
      if (context?.enabled && !context.forceVariant) {
        contextSaved = contextVariant;
        try {
          sessionStorage.setItem("bsm:CTX-001:variant", contextVariant);
        } catch {
          /* Memory fallback. */
        }
      }
      if (contextVariant !== measuredContext) {
        contextStudy.clear();
        measuredContext = contextVariant;
      }
      const measureContext =
        !!context?.enabled &&
        flags.measurementEnabled &&
        params.get("ux_measure") === "1";
      contextStudy.enable(measureContext);
      if (measureContext) window.boxStorageSearchUx = contextStudy;
      else delete window.boxStorageSearchUx;
      setRestoreSearch(contextVariant === "restore-search");
      document.documentElement.dataset.searchContext = contextVariant;
      if (flags.enabled && !flags.forceVariant) {
        saved = next;
        try {
          sessionStorage.setItem("bsm:NAV-001:variant", next);
        } catch {
          /* Memory fallback. */
        }
      }
      if (next !== measuredVariant) {
        study.clear();
        measuredVariant = next;
      }
      setVariant(next);
      document.documentElement.dataset.uiVariant = next;
      const measuring =
        flags.enabled &&
        flags.measurementEnabled &&
        params.get("ux_measure") === "1";
      study.enable(measuring);
      if (measuring) window.boxStorageUx = study;
      else delete window.boxStorageUx;
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    let lastScroll = 0;
    const scroll = () => {
      if (performance.now() - lastScroll > 1000) {
        study.record("scroll");
        lastScroll = performance.now();
      }
    };
    const click = (event: MouseEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('nav[aria-label="Main navigation"] a')
      )
        study.record("navigation");
    };
    window.addEventListener("scroll", scroll, { passive: true });
    document.addEventListener("click", click);
    return () => {
      disposed = true;
      controller?.abort();
      window.clearInterval(timer);
      window.removeEventListener("scroll", scroll);
      document.removeEventListener("click", click);
      delete window.boxStorageUx;
      delete window.boxStorageSearchUx;
      delete window.boxStoragePhotoUx;
      delete window.boxStorageReferenceUx;
      delete document.documentElement.dataset.uiVariant;
      delete document.documentElement.dataset.searchContext;
      delete document.documentElement.dataset.photoRecognition;
      delete document.documentElement.dataset.referenceLayout;
    };
  }, []);
  return { variant, restoreSearch, photoRecognition, referenceLayout };
}
