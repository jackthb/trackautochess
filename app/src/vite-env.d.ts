/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_POSTHOG_DESKTOP_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
