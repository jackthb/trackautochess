import * as serverOnly from "@sanity/react-loader";
import type { ClientPerspective } from "next-sanity";
import { client } from "./client";

const { loadQuery, setServerClient } = serverOnly;

// Configure the server client once on import. The loader uses this client
// for all server-side `loadQuery` calls.
setServerClient(
  client.withConfig({
    token: process.env.SANITY_VIEWER_TOKEN,
  })
);

export function loadQueryOptions(context: { draftMode?: boolean }) {
  const { draftMode } = context;
  return draftMode
    ? {
        perspective: "drafts" as ClientPerspective,
        stega: true,
        useCdn: false,
      }
    : {};
}

export { loadQuery };
