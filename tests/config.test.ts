import { describe, expect, it } from "vitest";
import {
  resolveConfig,
  NazarConfigError,
  DEFAULT_ENDPOINT,
} from "../src/config.js";

describe("resolveConfig", () => {
  it("throws a helpful error when apiKey is missing", () => {
    // @ts-expect-error intentionally invalid input
    expect(() => resolveConfig({})).toThrow(NazarConfigError);
    // @ts-expect-error intentionally invalid input
    expect(() => resolveConfig({})).toThrow(/apiKey/);
  });

  it("throws when options is not an object", () => {
    // @ts-expect-error intentionally invalid input
    expect(() => resolveConfig(undefined)).toThrow(NazarConfigError);
  });

  it("applies privacy-first defaults", () => {
    const config = resolveConfig({ apiKey: "nz_live_abc" });
    expect(config.capturePrompts).toBe(false);
    expect(config.captureResponses).toBe(false);
    expect(config.redactSensitiveData).toBe(true);
    expect(config.enabled).toBe(true);
  });

  it("uses the default endpoint when not provided", () => {
    const config = resolveConfig({ apiKey: "nz_live_abc" });
    expect(config.endpoint).toBe(DEFAULT_ENDPOINT);
  });

  it("strips trailing slashes from a custom endpoint", () => {
    const config = resolveConfig({
      apiKey: "nz_live_abc",
      endpoint: "https://custom.example.com/",
    });
    expect(config.endpoint).toBe("https://custom.example.com");
  });

  it("respects explicit overrides", () => {
    const config = resolveConfig({
      apiKey: "nz_live_abc",
      capturePrompts: true,
      captureResponses: true,
      redactSensitiveData: false,
      environment: "staging",
      batchSize: 5,
      maxQueueSize: 50,
    });
    expect(config.capturePrompts).toBe(true);
    expect(config.captureResponses).toBe(true);
    expect(config.redactSensitiveData).toBe(false);
    expect(config.environment).toBe("staging");
    expect(config.batchSize).toBe(5);
    expect(config.maxQueueSize).toBe(50);
  });

  it("rejects non-positive batchSize and maxQueueSize", () => {
    expect(() => resolveConfig({ apiKey: "x", batchSize: 0 })).toThrow(
      NazarConfigError,
    );
    expect(() => resolveConfig({ apiKey: "x", maxQueueSize: -1 })).toThrow(
      NazarConfigError,
    );
  });
});
