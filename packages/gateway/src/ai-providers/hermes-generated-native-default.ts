import type { AiProviderSnapshotV3, ProviderModelProvider } from "@matrix-os/contracts";
import type { HarnessConfiguration } from "./provider-settings-persistence.js";

/** CLI login initializes only an untouched generated default, never owner intent. */
export function hermesGeneratedNativeDefault(
  driver: AiProviderSnapshotV3["drivers"][number] | undefined, now: Date,
): HarnessConfiguration | null {
  const observed = driver?.nativeRouteObservation;
  if (!driver || driver.id !== "hermes" || driver.installState !== "installed"
    || !["ready", "degraded"].includes(driver.health) || !observed
    || !["openai-codex", "openai-api", "openrouter"].includes(observed.providerId)
    || observed.credentialKind !== (observed.providerId === "openai-codex" ? "provider_profile" : "api_key")
    || observed.localObservation.state !== "present_unverified") return null;
  const checked = Date.parse(observed.localObservation.checkedAt ?? "");
  const expires = Date.parse(observed.localObservation.staleAfter ?? "");
  if (!Number.isFinite(checked) || !Number.isFinite(expires) || checked > +now
    || expires <= +now || expires - checked > 5000) return null;
  return { id: "harness_hermes", driverId: "hermes", harness: "hermes", displayName: driver.displayName,
    accentColor: null, enabled: true, enablementOrigin: "generated_default",
    selectedAccountId: null, accessSourceId: null,
    route: { kind: "configurable", providerId: observed.providerId, modelId: observed.modelId } };
}

/** The native CLI owns this route; discovering it never creates a shared account. */
export function addHermesGeneratedNativeModel(input: {
  providers: ProviderModelProvider[]; driver: AiProviderSnapshotV3["drivers"][number] | undefined;
  harnesses: HarnessConfiguration[]; now: Date;
}): void {
  const native = hermesGeneratedNativeDefault(input.driver, input.now);
  const stored = input.harnesses.filter(h => h.harness === "hermes" && h.accessSourceId === null
    && ["openai-codex", "openai-api", "openrouter"].includes(h.route.providerId));
  for (const harness of stored) {
    const enabled = native?.route.providerId === harness.route.providerId && native.route.modelId === harness.route.modelId;
    // Model IDs are global in the settings contract; a different provider's
    // existing model cannot be reinterpreted as a native credential route.
    if (input.providers.some(p => p.id !== harness.route.providerId && p.models.some(m => m.id === harness.route.modelId))) continue;
    let provider = input.providers.find(p => p.id === harness.route.providerId);
    if (!provider) {
      if (input.providers.length >= 32) continue;
      provider = { id: harness.route.providerId, displayName: `Hermes ${harness.route.providerId}`, models: [] };
      input.providers.push(provider);
    }
    if (!provider.models.some(m => m.id === harness.route.modelId) && provider.models.length < 256) {
      provider.models.push({ id: harness.route.modelId, displayName: harness.route.modelId, enabled });
    }
  }
}
