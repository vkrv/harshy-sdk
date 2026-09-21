import { describe, expect, it } from "vitest";

import { createHarshy, createSimulatedEngine } from "./index";

describe("startPreview", () => {
  it("streams GPS and IMU without starting a trip", async () => {
    const locations: number[] = [];
    const imu: number[] = [];
    const client = createHarshy({
      engine: createSimulatedEngine(),
      nativeAvailable: false,
    });
    client.subscribe({
      onLocation: (sample) => {
        locations.push(sample.t);
      },
      onImu: (sample) => {
        imu.push(sample.t);
      },
      onEvent: () => {
        throw new Error("preview must not emit trip events");
      },
    });

    await client.startPreview();
    expect(client.getState().running).toBe(false);
    expect(client.getState().previewing).toBe(true);
    expect(client.getLastSession()).toBeNull();

    await new Promise((resolve) => {
      setTimeout(resolve, 120);
    });
    expect(imu.length).toBeGreaterThan(0);
    expect(locations.length).toBeGreaterThan(0);

    await client.stopPreview();
    expect(client.getState().previewing).toBe(false);
    expect(client.getState().running).toBe(false);
    const imuAfter = imu.length;
    await new Promise((resolve) => {
      setTimeout(resolve, 80);
    });
    expect(imu.length).toBe(imuAfter);
  });

  it("leaves an armed watch in place", async () => {
    let armed = 0;
    let disarmed = 0;
    const client = createHarshy({
      nativeAvailable: false,
      engine: {
        ...createSimulatedEngine(),
        armWatch: async () => {
          armed += 1;
        },
        disarmWatch: async () => {
          disarmed += 1;
        },
      },
    });
    await client.arm();
    expect(armed).toBe(1);
    await client.startPreview();
    expect(disarmed).toBe(0);
    expect(client.getWatchState().phase).toBe("armed");
    await client.stopPreview();
    expect(disarmed).toBe(0);
    expect(client.getState().running).toBe(false);
  });

  it("lets start() take over a preview as a trip", async () => {
    const client = createHarshy({
      engine: createSimulatedEngine({ immediate: true }),
      nativeAvailable: false,
    });
    await client.startPreview();
    expect(client.getState().previewing).toBe(true);
    await client.start({ source: "simulated" });
    expect(client.getState().running).toBe(true);
    expect(client.getState().previewing).toBe(false);
    const session = await client.stop();
    expect(session.location.length).toBeGreaterThan(0);
  });
});
