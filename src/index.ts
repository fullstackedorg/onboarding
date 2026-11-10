// The onboarding's API, for the app's shell and for other shells that embed it
export {
    startOnboarding,
    shouldRunOnboarding,
    markOnboardingDone,
    ONBOARDING_CONFIG_KEY,
    type OnboardingOptions,
    type OnboardingStats,
    type OnboardingHandle
} from "./onboarding";
export type { BuildReport, StepId } from "./build";
export { DEMO_COMMIT, DEMO_REPOSITORY } from "./demo-pin";
