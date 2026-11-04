import { describe, expect, it } from "vitest";
import { commonErrorSchema, operationIntentSchema } from "./operation.js";

describe("shared operation contracts", () => {
  it("accepts an operation bound to its target and plan", () => {
    const value = {
      operationId: "8b03f0cc-02a6-45cb-a597-82ea02104e86",
      destinationFingerprint: "postgres:sha256:target",
      planHash: `sha256:${"a".repeat(64)}`,
      nonce: "d031ab94-70c4-45b0-8e2d-62010b92d383",
      expiresAt: "2026-11-04T12:00:00.000Z"
    };

    expect(operationIntentSchema.parse(value)).toEqual(value);
  });

  it("rejects an invalid plan digest and unexpected secret fields", () => {
    const value = {
      operationId: "8b03f0cc-02a6-45cb-a597-82ea02104e86",
      destinationFingerprint: "sqlite:sha256:target",
      planHash: "not-a-hash",
      nonce: "d031ab94-70c4-45b0-8e2d-62010b92d383",
      expiresAt: "2026-11-04T12:00:00.000Z",
      credentialValue: "synthetic-fixture"
    };

    expect(operationIntentSchema.safeParse(value).success).toBe(false);
  });

  it("validates common errors and rejects undeclared fields", () => {
    const value = {
      code: "VALIDATION_ERROR",
      message: "Request is invalid",
      requestId: "8b03f0cc-02a6-45cb-a597-82ea02104e86"
    };

    expect(commonErrorSchema.parse(value)).toEqual(value);
    expect(commonErrorSchema.safeParse({ ...value, credential: "synthetic" }).success).toBe(false);
  });
});
