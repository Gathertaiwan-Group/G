import type { StepHandler } from "./types"
import type { ProvisioningStep } from "@realreal/control-db"

const handlers = new Map<ProvisioningStep, StepHandler>()

export function registerHandler(h: StepHandler): void {
  handlers.set(h.step, h)
}
export function getHandler(step: ProvisioningStep): StepHandler | undefined {
  return handlers.get(step)
}
export function registeredSteps(): ProvisioningStep[] {
  return [...handlers.keys()]
}
