import {
  analyzeTrip,
  createTripAnalyzer,
  emptyTripEndState,
  emptyTripStartState,
  endedAtMsWithoutIdleTail,
  commitStartConfig,
  locationToWatchFix,
  mergeDetectorConfig,
  mergeNativeStartOptions,
  mergeTripHeuristicConfig,
  parseTripTrigger,
  MAX_LOCATION_SAMPLES,
  advanceIdleMotion,
  emptyIdleMotionState,
  isIdle,
  maxImuSamples,
  shouldEndTrip,
  shouldStartTrip,
  trimIdleTailSamples,
  trimRingBuffer,
  uploadSession,
  warmupEndConfig,
  type DetectorConfig,
  type IdleMotionState,
  type LiveMetrics,
  type LocationSample,
  type PermissionResult,
  type RecordingMode,
  type SessionExport,
  type TripAnalyzer,
  type TripHeuristicConfig,
  type TripTrigger,
  type UploadAdapter,
  type WatchFix,
} from "@harshy/core";

import type { JsonFileStore } from "./json-file-store";
import { createSessionArchive } from "./session-archive";
import { createSimulatedEngine } from "./simulated-engine";
import { formatTripLiveDisplay } from "./trip-live";
import type {
  ArmWatchOptions,
  HarshyClientState,
  HarshyListeners,
  HarshySource,
  HarshyStartOptions,
  NativeStartOptions,
  SensorEngine,
  TripLiveDisplayPayload,
  WatchState,
} from "./types";

export type HarshyClient = {
  getState: () => HarshyClientState;
  getCapabilities: () => ReturnType<SensorEngine["getCapabilities"]>;
  getPermissionStatus: () => ReturnType<SensorEngine["getPermissionStatus"]>;
  requestPermissions: () => ReturnType<SensorEngine["requestPermissions"]>;
  /** One system prompt. The host explains that permission in the app first. */
  requestPermission: (kind: keyof PermissionResult) => ReturnType<SensorEngine["requestPermissions"]>;
  /** Background / Always location. Does not prompt until the host calls it. */
  requestBackgroundLocation: () => ReturnType<SensorEngine["requestPermissions"]>;
  start: (options?: HarshyStartOptions) => Promise<void>;
  /**
   * Foreground GPS+IMU readout without starting a trip. No journal, FGS,
   * Live Activity, or session. Leaves an armed watch in place. No-op while
   * a trip is running.
   */
  startPreview: (options?: HarshyStartOptions) => Promise<void>;
  /** Stop a Sensors-tab readout. Does not stop a running trip. */
  stopPreview: () => Promise<void>;
  /** Attach to a native trip that survived process death. Returns true when capture is live. */
  recover: (options?: HarshyStartOptions) => Promise<boolean>;
  stop: () => Promise<SessionExport>;
  /**
   * Opt in to automatic trips. Default client is manual (disarmed).
   * Native engines start a sparse OS watch (`armWatch`). Simulated engines
   * only track JS state unless a test double implements `subscribeWatch`.
   */
  arm: (options?: ArmWatchOptions) => Promise<void>;
  /** Leave Auto mode. Does not stop a running trip. */
  disarm: () => Promise<void>;
  getWatchState: () => WatchState;
  setDetectorConfig: (config: Partial<DetectorConfig>) => SessionExport | null;
  getDetectorConfig: () => DetectorConfig;
  getLastSession: () => SessionExport | null;
  /**
   * GPS samples for the in-progress trip. Empty when idle.
   * `recover()` does not re-emit journal fixes on `onLocation` — hosts that
   * draw a live path should seed from this, then append new `onLocation` samples.
   */
  getLiveLocation: () => LocationSample[];
  /** Compact sessions from `historyStore` (IMU dropped). Empty until `loadHistory()` or a persist. */
  getHistory: () => SessionExport[];
  loadHistory: () => Promise<SessionExport[]>;
  /** Wait for a background history write (retune). `stop()` already awaits persist. */
  flushHistory: () => Promise<void>;
  subscribe: (listeners: HarshyListeners) => () => void;
  setUploadAdapter: (adapter: UploadAdapter | null) => void;
  upload: (session?: SessionExport) => Promise<void>;
  retune: (config: Partial<DetectorConfig>) => SessionExport | null;
};

export type CreateHarshyDeps = {
  engine?: SensorEngine;
  createNativeEngine?: () => SensorEngine;
  nativeAvailable?: boolean;
  /** Default detector merged on `start()`. `recover()` keeps the live config unless `detector` is passed. */
  detector?: Partial<DetectorConfig>;
  /** Merged into native/sim start options unless `start({ native })` overrides. */
  native?: Partial<NativeStartOptions>;
  /**
   * Durable trip archive (one JSON file per session + `index.json`).
   * `stop()` / idle `retune()` write a compact copy (no IMU).
   * Signumb keeps its own LabRecording archive — do not pass this from the lab client.
   */
  historyStore?: JsonFileStore;
  maxHistory?: number;
  /** App name on the trip notification / Live Activity. Defaults to Signumb. */
  liveDisplayTitle?: string;
  /** Override metric formatting (e.g. imperial units in Signumb). */
  formatLiveDisplay?: (metrics: LiveMetrics, title: string) => TripLiveDisplayPayload;
};

function newSessionId(): string {
  return `trip-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function resolveSource(
  requested: HarshySource | undefined,
  nativeAvailable: boolean,
): "native" | "simulated" {
  if (requested === "simulated") {
    return "simulated";
  }
  if (requested === "native") {
    if (!nativeAvailable) {
      throw new Error("Native Harshy engine is not available on this platform");
    }
    return "native";
  }
  return nativeAvailable ? "native" : "simulated";
}

export function createHarshy(deps: CreateHarshyDeps = {}): HarshyClient {
  const nativeAvailable = deps.nativeAvailable ?? Boolean(deps.createNativeEngine);
  const sessionArchive = deps.historyStore
    ? createSessionArchive(deps.historyStore, { maxItems: deps.maxHistory })
    : null;
  let engine: SensorEngine | null = deps.engine ?? null;
  let analyzer: TripAnalyzer | null = null;
  let unsubscribeEngine: (() => void) | null = null;
  let lastSession: SessionExport | null = null;
  let history: SessionExport[] = [];
  let persistTail: Promise<void> = Promise.resolve();
  let lastRaw: {
    location: SessionExport["location"];
    imu: SessionExport["imu"];
    startedAtMs: number;
    endedAtMs: number;
    sessionId: string;
    device: SessionExport["device"];
    trigger: TripTrigger;
  } | null = null;
  let uploadAdapter: UploadAdapter | null = null;
  let detectorConfig = mergeDetectorConfig(deps.detector);
  let running = false;
  let previewing = false;
  let source: HarshyClientState["source"] = "idle";
  let sessionId: string | null = null;
  const listeners = new Set<HarshyListeners>();
  let lastLivePublishMs = 0;
  const liveTitle = deps.liveDisplayTitle ?? "Signumb";
  const formatLive =
    deps.formatLiveDisplay ?? ((metrics: LiveMetrics, title: string) => formatTripLiveDisplay(metrics, title));
  let nativeImuHz = mergeNativeStartOptions(deps.native).imuHz;
  let idleMotion: IdleMotionState = emptyIdleMotionState();
  let recordingMode: RecordingMode = "manual";
  let tripTrigger: TripTrigger | null = null;
  let heuristicConfig: TripHeuristicConfig = mergeTripHeuristicConfig();
  let startHeuristic = emptyTripStartState();
  let endHeuristic = emptyTripEndState();
  let unsubscribeWatch: (() => void) | null = null;
  let lastWatchFix: WatchFix | null = null;
  let startingFromWatch = false;
  let endingFromWatch = false;
  let discardNextStop = false;
  let tripWarmup = false;
  let commitHeuristic = emptyTripStartState();
  let requestAutoStart: () => Promise<void> = async () => undefined;
  let requestAutoStop: () => Promise<SessionExport> = async () => {
    throw new Error("Harshy client is not ready");
  };

  const trimLastRaw = () => {
    if (!lastRaw) {
      return;
    }
    trimRingBuffer(lastRaw.location, MAX_LOCATION_SAMPLES);
    trimRingBuffer(lastRaw.imu, maxImuSamples(nativeImuHz));
  };

  const publishLiveDisplay = (metrics: LiveMetrics, force = false) => {
    const now = Date.now();
    if (!force && now - lastLivePublishMs < 900) {
      return;
    }
    lastLivePublishMs = now;
    // Lock-screen duration must follow wall clock — sample.t from GPS/IMU jitters.
    const durationMs =
      lastRaw != null ? Math.max(0, now - lastRaw.startedAtMs) : metrics.durationMs;
    const payload = formatLive({ ...metrics, durationMs }, liveTitle);
    void engine?.updateLiveDisplay?.(payload);
  };

  const getState = (): HarshyClientState => ({
    running,
    previewing,
    source,
    sessionId,
    startedAtMs: running && lastRaw != null ? lastRaw.startedAtMs : null,
    nativeAvailable,
  });

  const getWatchState = (): WatchState => ({
    mode: recordingMode,
    phase: running
      ? tripTrigger === "auto" && tripWarmup
        ? "warmup"
        : "recording"
      : recordingMode === "auto"
        ? "armed"
        : "disarmed",
    trigger: running ? (tripTrigger ?? "manual") : null,
    suppressed: running && recordingMode === "auto" && tripTrigger === "manual",
    nativeWatch: Boolean(engine?.armWatch),
    lastFix: lastWatchFix,
    startHoldMs:
      lastWatchFix != null && startHeuristic.movingSinceMs != null
        ? Math.max(0, lastWatchFix.t - startHeuristic.movingSinceMs)
        : 0,
    startDistanceM: startHeuristic.distanceM,
  });

  const emitWatchState = () => {
    const state = getWatchState();
    for (const listener of listeners) {
      listener.onWatchState?.(state);
    }
  };

  const emitState = () => {
    const state = getState();
    for (const listener of listeners) {
      listener.onState?.(state);
    }
  };

  const unbindWatch = () => {
    unsubscribeWatch?.();
    unsubscribeWatch = null;
  };

  const bindWatch = () => {
    unbindWatch();
    startHeuristic = emptyTripStartState();
    lastWatchFix = null;
    if (!engine?.subscribeWatch || recordingMode !== "auto" || running) {
      return;
    }
    unsubscribeWatch = engine.subscribeWatch({
      onFix: (fix) => {
        if (running || recordingMode !== "auto" || startingFromWatch) {
          return;
        }
        lastWatchFix = fix;
        const decided = shouldStartTrip(startHeuristic, fix, heuristicConfig);
        startHeuristic = decided.state;
        emitWatchState();
        if (!decided.start || engine?.kind === "native") {
          return;
        }
        startingFromWatch = true;
        void requestAutoStart().catch((error) => {
          const message = error instanceof Error ? error.message : "Automatic start failed";
          for (const listener of listeners) {
            listener.onError?.({ code: "auto_start", message });
          }
        }).finally(() => {
          startingFromWatch = false;
        });
      },
      onError: (error) => {
        for (const listener of listeners) {
          listener.onError?.(error);
        }
      },
      onNativeRunning: () => {
        if (running || recordingMode !== "auto") {
          return;
        }
        void attachIfRunning().catch((error) => {
          const message = error instanceof Error ? error.message : "Automatic start failed";
          for (const listener of listeners) {
            listener.onError?.({ code: "auto_start", message });
          }
        });
      },
    });
  };

  const tearDownWatch = async () => {
    unbindWatch();
    lastWatchFix = null;
    startHeuristic = emptyTripStartState();
    if (engine?.disarmWatch) {
      await engine.disarmWatch();
    }
  };

  const pickEngine = (
    resolved: "native" | "simulated",
    playbackSpeed: number,
  ): SensorEngine => {
    if (deps.engine) {
      return deps.engine;
    }
    if (resolved === "native") {
      if (engine?.kind === "native") {
        return engine;
      }
      if (!deps.createNativeEngine) {
        throw new Error("Native engine factory was not provided");
      }
      return deps.createNativeEngine();
    }
    return createSimulatedEngine({ playbackSpeed });
  };

  const resolveEngine = (): SensorEngine => {
    if (!engine) {
      engine = nativeAvailable
        ? pickEngine("native", 1)
        : createSimulatedEngine();
    }
    return engine;
  };

  const engageWatch = async () => {
    if (recordingMode !== "auto" || running) {
      return;
    }
    const eng = resolveEngine();
    // Subscribe before arm so the first native last-known / single fix is not dropped.
    bindWatch();
    if (eng.armWatch) {
      await eng.armWatch({ heuristic: heuristicConfig });
    }
  };

  const ingestAutoLocation = (
    sample: { t: number; lat: number; lon: number; speedMps?: number | null; accuracyM?: number | null },
  ): { end: boolean; discard: boolean } => {
    if (tripTrigger !== "auto") {
      return { end: false, discard: false };
    }
    const fix = locationToWatchFix(sample);
    if (tripWarmup) {
      const committed = shouldStartTrip(
        commitHeuristic,
        fix,
        commitStartConfig(heuristicConfig),
      );
      commitHeuristic = committed.state;
      if (committed.start) {
        tripWarmup = false;
        endHeuristic = emptyTripEndState();
        emitWatchState();
      }
    }
    const decided = shouldEndTrip(
      endHeuristic,
      fix,
      tripWarmup ? warmupEndConfig(heuristicConfig) : heuristicConfig,
    );
    endHeuristic = decided.state;
    return { end: decided.end, discard: decided.end && tripWarmup };
  };

  const requestAutoEnd = (discard: boolean) => {
    if (endingFromWatch) {
      return;
    }
    endingFromWatch = true;
    discardNextStop = discard;
    void requestAutoStop().catch((error) => {
      const message = error instanceof Error ? error.message : "Automatic stop failed";
      for (const listener of listeners) {
        listener.onError?.({ code: "auto_stop", message });
      }
    }).finally(() => {
      endingFromWatch = false;
    });
  };

  const bindEngine = () => {
    if (!engine) {
      return;
    }
    unsubscribeEngine?.();
    unsubscribeEngine = engine.subscribe({
      onLocation: (sample) => {
        for (const listener of listeners) {
          listener.onLocation?.(sample);
        }
        if (!analyzer) {
          return;
        }
        const gated = advanceIdleMotion(
          idleMotion,
          sample,
          detectorConfig.minSpeedMps,
        );
        idleMotion = gated.state;
        lastRaw?.location.push(sample);
        trimLastRaw();
        const result = analyzer.pushLocation(sample);
        if (!result) {
          return;
        }
        for (const listener of listeners) {
          listener.onMetrics?.(result.metrics);
          for (const event of result.newEvents) {
            listener.onEvent?.(event);
          }
        }
        publishLiveDisplay(result.metrics);
        if (running && tripTrigger === "auto" && !endingFromWatch) {
          const decided = ingestAutoLocation(sample);
          if (decided.end) {
            requestAutoEnd(decided.discard);
          }
        }
      },
      onImu: (sample) => {
        // Native engines already skip idle IMU; simulated/web still get full rate.
        if (analyzer && isIdle(idleMotion, sample.t)) {
          return;
        }
        for (const listener of listeners) {
          listener.onImu?.(sample);
        }
        if (!analyzer) {
          return;
        }
        lastRaw?.imu.push(sample);
        trimLastRaw();
        const result = analyzer.pushImu(sample);
        if (!result) {
          return;
        }
        for (const listener of listeners) {
          listener.onMetrics?.(result.metrics);
          for (const event of result.newEvents) {
            listener.onEvent?.(event);
          }
        }
        publishLiveDisplay(result.metrics);
      },
      onError: (error) => {
        for (const listener of listeners) {
          listener.onError?.(error);
        }
      },
    });
  };

  const emitPersistError = (error: unknown) => {
    const message = error instanceof Error ? error.message : "Could not save the trip";
    for (const listener of listeners) {
      listener.onError?.({ code: "persist", message });
    }
  };

  const enqueuePersist = (work: () => Promise<void>): Promise<void> => {
    const next = persistTail.then(work, work);
    persistTail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const persistSession = async (session: SessionExport): Promise<void> => {
    if (!sessionArchive) {
      return;
    }
    history = await sessionArchive.put(session);
  };

  const attachIfRunning = async (options?: HarshyStartOptions): Promise<boolean> => {
    if (!engine || engine.kind !== "native") {
      return false;
    }
    if (!(await engine.isRunning())) {
      return false;
    }
    const raw = await engine.getSnapshot();
    if (!raw.sessionId && raw.location.length === 0) {
      return false;
    }
    detectorConfig = mergeDetectorConfig({
      ...detectorConfig,
      ...options?.detector,
    });
    sessionId = raw.sessionId ?? sessionId ?? newSessionId();
    const device = options?.device ?? lastRaw?.device ?? {
      platform: "unknown" as const,
      model: null,
    };
    const trigger = parseTripTrigger(raw.trigger ?? options?.trigger ?? lastRaw?.trigger);
    analyzer = createTripAnalyzer(detectorConfig, {
      sessionId,
      startedAtMs: raw.startedAtMs || Date.now(),
      device,
      imuHz: nativeImuHz,
      trigger,
    });
    lastRaw = {
      location: [...raw.location],
      imu: [...raw.imu],
      startedAtMs: raw.startedAtMs,
      endedAtMs: raw.endedAtMs,
      sessionId,
      device,
      trigger,
    };
    tripTrigger = trigger;
    await tearDownWatch();
    trimLastRaw();
    idleMotion = emptyIdleMotionState();
    endHeuristic = emptyTripEndState();
    commitHeuristic = emptyTripStartState();
    tripWarmup = trigger === "auto";
    let lastMetrics: LiveMetrics | null = null;
    let shouldAutoStop = false;
    let autoStopDiscard = false;
    for (const sample of lastRaw.location) {
      const gated = advanceIdleMotion(
        idleMotion,
        sample,
        detectorConfig.minSpeedMps,
      );
      idleMotion = gated.state;
      const result = analyzer.pushLocation(sample);
      if (result) {
        lastMetrics = result.metrics;
      }
      if (trigger === "auto") {
        const decided = ingestAutoLocation(sample);
        if (decided.end) {
          shouldAutoStop = true;
          autoStopDiscard = decided.discard;
        }
      }
    }
    for (const sample of lastRaw.imu) {
      if (!isIdle(idleMotion, sample.t)) {
        analyzer.pushImu(sample);
      }
    }
    bindEngine();
    running = true;
    source = "native";
    emitState();
    emitWatchState();
    if (lastMetrics) {
      for (const listener of listeners) {
        listener.onMetrics?.(lastMetrics);
      }
      publishLiveDisplay(lastMetrics, true);
    }
    if (shouldAutoStop && !endingFromWatch) {
      endingFromWatch = true;
      discardNextStop = autoStopDiscard;
      try {
        await requestAutoStop();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Automatic stop failed";
        for (const listener of listeners) {
          listener.onError?.({ code: "auto_stop", message });
        }
      } finally {
        endingFromWatch = false;
      }
    }
    return true;
  };

  const client: HarshyClient = {
    getState,
    getCapabilities: () => resolveEngine().getCapabilities(),
    getPermissionStatus: () => resolveEngine().getPermissionStatus(),
    requestPermissions: () => resolveEngine().requestPermissions(),
    requestPermission: (kind) => {
      const engine = resolveEngine();
      if (kind === "backgroundLocation") {
        return engine.requestBackgroundLocation?.() ?? engine.requestPermissions();
      }
      return engine.requestPermission?.(kind) ?? engine.requestPermissions();
    },
    requestBackgroundLocation: () => {
      const engine = resolveEngine();
      return engine.requestBackgroundLocation?.() ?? engine.requestPermissions();
    },
    async start(options) {
      if (running) {
        await client.stop();
      }
      const wasPreviewing = previewing;
      previewing = false;
      tripTrigger = options?.trigger ?? "manual";
      await tearDownWatch();
      const resolved = resolveSource(options?.source, nativeAvailable);
      const previousEngine = engine;
      engine = pickEngine(resolved, options?.playbackSpeed ?? 1);
      if (previousEngine && previousEngine !== engine) {
        await previousEngine.stopPreview?.();
      }
      detectorConfig = mergeDetectorConfig({
        ...deps.detector,
        ...options?.detector,
      });
      const nativeOpts = mergeNativeStartOptions({
        ...deps.native,
        ...options?.native,
        trigger: tripTrigger,
      });
      nativeImuHz = nativeOpts.imuHz;
      if (resolved === "native" && (await attachIfRunning(options))) {
        try {
          await engine.start(nativeOpts);
        } catch {
          // Already capturing — attach owns the live session.
        }
        emitWatchState();
        return;
      }
      sessionId = newSessionId();
      const startedAtMs = Date.now();
      const device = options?.device ?? {
        platform: resolved === "simulated" ? "web" : "unknown",
        model: null,
      };
      analyzer = createTripAnalyzer(detectorConfig, {
        sessionId,
        startedAtMs,
        device,
        imuHz: nativeImuHz,
        trigger: tripTrigger,
      });
      lastRaw = {
        location: [],
        imu: [],
        startedAtMs,
        endedAtMs: startedAtMs,
        sessionId,
        device,
        trigger: tripTrigger,
      };
      idleMotion = emptyIdleMotionState();
      endHeuristic = emptyTripEndState();
      commitHeuristic = emptyTripStartState();
      tripWarmup = tripTrigger === "auto";
      bindEngine();
      try {
        await engine.start(nativeOpts);
      } catch (error) {
        unsubscribeEngine?.();
        unsubscribeEngine = null;
        analyzer = null;
        lastRaw = null;
        running = false;
        source = "idle";
        tripTrigger = null;
        const resumePreview = engine.startPreview?.bind(engine);
        if (wasPreviewing && resumePreview) {
          bindEngine();
          try {
            await resumePreview(
              mergeNativeStartOptions({
                ...deps.native,
                ...options?.native,
                background: false,
              }),
            );
            previewing = true;
          } catch {
            previewing = false;
            unsubscribeEngine = null;
          }
          emitState();
          await engageWatch();
          emitWatchState();
          throw error;
        }
        emitState();
        await engageWatch();
        emitWatchState();
        throw error;
      }
      running = true;
      previewing = false;
      source = resolved;
      emitState();
      emitWatchState();
      const metrics = analyzer?.getMetrics();
      if (metrics) {
        publishLiveDisplay(metrics, true);
      }
    },
    async startPreview(options) {
      if (running || previewing) {
        return;
      }
      const resolved = resolveSource(options?.source, nativeAvailable);
      engine = pickEngine(resolved, options?.playbackSpeed ?? 1);
      if (!engine.startPreview) {
        return;
      }
      bindEngine();
      try {
        await engine.startPreview(
          mergeNativeStartOptions({
            ...deps.native,
            ...options?.native,
            background: false,
          }),
        );
      } catch (error) {
        unsubscribeEngine?.();
        unsubscribeEngine = null;
        previewing = false;
        emitState();
        throw error;
      }
      previewing = true;
      emitState();
    },
    async stopPreview() {
      if (!previewing) {
        return;
      }
      previewing = false;
      if (running) {
        emitState();
        return;
      }
      await engine?.stopPreview?.();
      unsubscribeEngine?.();
      unsubscribeEngine = null;
      emitState();
    },
    async recover(options) {
      if (!nativeAvailable) {
        return false;
      }
      engine = pickEngine("native", 1);
      return attachIfRunning(options);
    },
    async stop() {
      const discard = discardNextStop;
      discardNextStop = false;
      const liveAnalyzer = analyzer;
      const priorRaw = lastRaw;
      const idleStartedAtMs = endHeuristic.slowSinceMs;
      const cutIdleTail =
        !discard &&
        endingFromWatch &&
        priorRaw?.trigger === "auto" &&
        idleStartedAtMs != null;
      const raw = engine
        ? await engine.stop({ handoffToWatch: recordingMode === "auto" })
        : null;
      void engine?.clearLiveDisplay?.();
      lastLivePublishMs = 0;
      unsubscribeEngine?.();
      unsubscribeEngine = null;
      running = false;
      previewing = false;
      source = "idle";
      tripTrigger = null;
      tripWarmup = false;
      commitHeuristic = emptyTripStartState();
      emitState();
      if (discard) {
        analyzer = null;
        lastRaw = null;
        endHeuristic = emptyTripEndState();
        await engageWatch();
        emitWatchState();
        return (
          lastSession ??
          analyzeTrip({
            location: [],
            imu: [],
            sessionId: sessionId ?? newSessionId(),
            startedAtMs: Date.now(),
            endedAtMs: Date.now(),
            device: { platform: "unknown", model: null },
            config: detectorConfig,
            trigger: "auto",
          })
        );
      }
      if (!liveAnalyzer || !priorRaw) {
        analyzer = null;
        endHeuristic = emptyTripEndState();
        await engageWatch();
        emitWatchState();
        return (
          lastSession ??
          analyzeTrip({
            location: [],
            imu: [],
            sessionId: sessionId ?? newSessionId(),
            startedAtMs: Date.now(),
            endedAtMs: Date.now(),
            device: { platform: "unknown", model: null },
            config: detectorConfig,
            trigger: priorRaw?.trigger ?? "manual",
          })
        );
      }
      const fallbackEndedAtMs = raw?.endedAtMs ?? Date.now();
      // Catch up GPS the JS analyzer missed while the runtime was suspended.
      if (raw?.location?.length) {
        const lastT = priorRaw.location.at(-1)?.t ?? Number.NEGATIVE_INFINITY;
        for (const sample of raw.location) {
          if (sample.t > lastT) {
            if (!cutIdleTail) {
              liveAnalyzer.pushLocation(sample);
            }
            priorRaw.location.push(sample);
          }
        }
        trimLastRaw();
      }
      const endedAtMs = cutIdleTail && idleStartedAtMs != null
        ? endedAtMsWithoutIdleTail(priorRaw.startedAtMs, idleStartedAtMs, fallbackEndedAtMs)
        : fallbackEndedAtMs;
      if (cutIdleTail && idleStartedAtMs != null) {
        lastSession = analyzeTrip({
          location: trimIdleTailSamples(priorRaw.location, idleStartedAtMs),
          imu: trimIdleTailSamples(priorRaw.imu, idleStartedAtMs),
          sessionId: priorRaw.sessionId,
          startedAtMs: priorRaw.startedAtMs,
          endedAtMs,
          device: priorRaw.device,
          config: detectorConfig,
          trigger: priorRaw.trigger,
        });
      } else {
        lastSession = liveAnalyzer.finalize(endedAtMs);
      }
      lastRaw = {
        location: lastSession.location,
        imu: lastSession.imu,
        startedAtMs: priorRaw.startedAtMs,
        endedAtMs,
        sessionId: lastSession.sessionId,
        device: priorRaw.device,
        trigger: priorRaw.trigger,
      };
      endHeuristic = emptyTripEndState();
      analyzer = null;
      try {
        await enqueuePersist(() => persistSession(lastSession!));
      } catch (error) {
        emitPersistError(error);
        await engageWatch();
        emitWatchState();
        throw error;
      }
      await engageWatch();
      emitWatchState();
      return lastSession;
    },
    async arm(options) {
      heuristicConfig = mergeTripHeuristicConfig({
        ...heuristicConfig,
        ...options?.heuristic,
      });
      recordingMode = "auto";
      if (running) {
        emitWatchState();
        return;
      }
      try {
        await engageWatch();
      } catch (error) {
        recordingMode = "manual";
        await tearDownWatch();
        emitWatchState();
        throw error;
      }
      emitWatchState();
    },
    async disarm() {
      recordingMode = "manual";
      await tearDownWatch();
      emitWatchState();
    },
    getWatchState,
    setDetectorConfig(config) {
      detectorConfig = mergeDetectorConfig({ ...detectorConfig, ...config });
      analyzer?.setConfig(detectorConfig);
      return client.retune(detectorConfig);
    },
    getDetectorConfig: () => ({
      ...detectorConfig,
      score: { ...detectorConfig.score },
    }),
    getLastSession: () => lastSession,
    getLiveLocation: () => (running && lastRaw ? lastRaw.location.slice() : []),
    getHistory: () => [...history],
    async loadHistory() {
      await persistTail;
      if (!sessionArchive) {
        return [...history];
      }
      history = await sessionArchive.load();
      return [...history];
    },
    flushHistory: () => persistTail,
    subscribe(listener) {
      listeners.add(listener);
      listener.onState?.(getState());
      listener.onWatchState?.(getWatchState());
      return () => {
        listeners.delete(listener);
      };
    },
    setUploadAdapter(adapter) {
      uploadAdapter = adapter;
    },
    async upload(session) {
      const payload = session ?? lastSession;
      if (!payload) {
        throw new Error("No session to upload");
      }
      await uploadSession(payload, uploadAdapter);
    },
    retune(config) {
      if (!lastRaw) {
        return lastSession;
      }
      detectorConfig = mergeDetectorConfig({ ...detectorConfig, ...config });
      lastSession = analyzeTrip({
        location: lastRaw.location,
        imu: lastRaw.imu,
        sessionId: lastRaw.sessionId,
        startedAtMs: lastRaw.startedAtMs,
        endedAtMs: lastRaw.endedAtMs,
        device: lastRaw.device,
        config: detectorConfig,
        trigger: lastRaw.trigger,
      });
      if (!running && lastSession) {
        void enqueuePersist(() => persistSession(lastSession!)).catch(emitPersistError);
      }
      return lastSession;
    },
  };

  requestAutoStart = () => client.start({ trigger: "auto" });
  requestAutoStop = () => client.stop();

  return client;
}

export const harshy = createHarshy();
