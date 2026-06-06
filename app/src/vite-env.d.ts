/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_POSTHOG_DESKTOP_TOKEN?: string;
  readonly VITE_POSTHOG_FEEDBACK_SURVEY_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
