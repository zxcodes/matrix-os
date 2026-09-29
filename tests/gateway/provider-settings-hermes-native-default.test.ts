import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ProviderSettingsStore } from "../../packages/gateway/src/ai-providers/provider-settings-store.js";
import { PROVIDER_SETTINGS_NOW as NOW, providerSettingsCanonicalFixture } from "./provider-settings-test-support.js";

it("adopts a fresh Hermes CLI login for its unconfigured default without borrowing an Anthropic account", async () => {
  const homePath = await mkdtemp(join(tmpdir(), "hermes-native-settings-"));
  const canonical = providerSettingsCanonicalFixture();
  const driver = { id: "hermes", displayName: "Hermes", kind: "cli" as const,
    installState: "installed" as const, health: "degraded" as const, capabilities: ["tools" as const], setupActions: [] };
  canonical.drivers.push(driver);
  const store = new ProviderSettingsStore({ homePath, now: () => NOW,
    providerSnapshotReader: { getSnapshot: async () => canonical }, runtimeCoordinator: {
      supportedActions: ["set_harness_enabled"], supportedHarnessKinds: ["hermes"],
      isRecoveryReady: () => true, reconcilePending: async () => undefined,
      applyConfiguration: async () => undefined, rollbackConfiguration: async () => undefined,
    } });
  try {
    expect((await store.getSnapshot()).harnesses.find(h => h.harness === "hermes")?.enabled).toBe(false);
    canonical.drivers[canonical.drivers.length - 1] = { ...driver, nativeRouteObservation: {
      providerId: "openai-codex", modelId: "gpt-5.6-sol", credentialKind: "provider_profile",
      localObservation: { state: "present_unverified", checkedAt: NOW.toISOString(), staleAfter: new Date(+NOW + 5000).toISOString() },
    } };
    const snapshot = await store.getSnapshot({ refresh: true });
    expect(snapshot.harnesses.find(h => h.harness === "hermes")).toMatchObject({
      enabled: true, configuredEnabled: true, selectedAccountId: null, accessSourceId: null,
      route: { kind: "configurable", providerId: "openai-codex", modelId: "gpt-5.6-sol" },
      authState: "unknown",
    });
    expect(snapshot.modelProviders.find(p => p.id === "openai-codex")?.models).toEqual([
      { id: "gpt-5.6-sol", displayName: "gpt-5.6-sol", enabled: true },
    ]);
    expect(snapshot.accounts).not.toContainEqual(expect.objectContaining({ providerId: "openai-codex" }));
    // An owner's saved Off switch is distinct from an untouched generated row.
    await store.mutate({ type: "set_harness_enabled", harnessInstanceId: "harness_hermes", enabled: false,
      expectedRevision: snapshot.revision, idempotencyKey: "native-off" });
    const disabled = await store.getSnapshot({ refresh: true });
    expect(disabled.harnesses.find(h => h.harness === "hermes")).toMatchObject({
      enabled: false, configuredEnabled: false,
    });
    const reenabled = await store.mutate({ type: "set_harness_enabled", harnessInstanceId: "harness_hermes", enabled: true,
      expectedRevision: disabled.revision, idempotencyKey: "native-on" });
    expect(reenabled.snapshot.harnesses.find(h => h.harness === "hermes")?.enabled).toBe(true);
  } finally { await rm(homePath, { recursive: true, force: true }); }
});

it.each(["expired", "future", "absent", "custom"])("does not initialize Hermes from %s native evidence", async mode => {
  const homePath = await mkdtemp(join(tmpdir(), "hermes-native-reject-"));
  const canonical = providerSettingsCanonicalFixture();
  canonical.drivers.push({ id: "hermes", displayName: "Hermes", kind: "cli", installState: "installed",
    health: "degraded", capabilities: ["tools"], setupActions: [], nativeRouteObservation: {
      providerId: "openai-codex", modelId: "gpt-5.6-sol", credentialKind: mode === "custom" ? "custom" : "provider_profile",
      localObservation: { state: mode === "absent" ? "absent" : "present_unverified",
        checkedAt: new Date(+NOW + (mode === "future" ? 1000 : mode === "expired" ? -6000 : 0)).toISOString(),
        staleAfter: new Date(+NOW + (mode === "expired" ? -1000 : 5000)).toISOString() },
    } });
  try {
    const snapshot = await new ProviderSettingsStore({ homePath, now: () => NOW,
      providerSnapshotReader: { getSnapshot: async () => canonical } }).getSnapshot();
    expect(snapshot.harnesses.find(h => h.harness === "hermes")?.enabled).toBe(false);
    expect(snapshot.modelProviders.some(p => p.id === "openai-codex")).toBe(false);
  } finally { await rm(homePath, { recursive: true, force: true }); }
});
