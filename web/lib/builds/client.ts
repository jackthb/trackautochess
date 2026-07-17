import {
  isUuid,
  type CommunityBuildDetail,
  type CommunityBuildSummary,
  type SavedBuild,
} from "@/lib/builds/types";

async function authHeaders(accessToken: string | null | undefined): Promise<HeadersInit> {
  if (!accessToken) return {};
  return { Authorization: `Bearer ${accessToken}` };
}

async function readError(res: Response): Promise<string> {
  try {
    const json = (await res.json()) as { error?: string };
    if (json.error) return json.error;
  } catch {
    // ignore
  }
  return res.statusText || "Request failed";
}

export async function fetchPublicBuilds(
  accessToken?: string | null,
): Promise<CommunityBuildSummary[]> {
  const res = await fetch("/api/builds", {
    headers: await authHeaders(accessToken),
  });
  if (!res.ok) throw new Error(await readError(res));
  const json = (await res.json()) as { builds: CommunityBuildSummary[] };
  return json.builds;
}

export async function fetchMyBuilds(
  accessToken: string,
): Promise<Array<CommunityBuildSummary & { payload: SavedBuild }>> {
  const res = await fetch("/api/builds?mine=1", {
    headers: await authHeaders(accessToken),
  });
  if (!res.ok) throw new Error(await readError(res));
  const json = (await res.json()) as {
    builds: Array<CommunityBuildSummary & { payload: SavedBuild }>;
  };
  return json.builds;
}

export async function fetchBuildDetail(
  id: string,
  accessToken?: string | null,
): Promise<CommunityBuildDetail> {
  const res = await fetch(`/api/builds/${id}`, {
    headers: await authHeaders(accessToken),
  });
  if (!res.ok) throw new Error(await readError(res));
  const json = (await res.json()) as { build: CommunityBuildDetail };
  return json.build;
}

export async function saveBuild(
  build: SavedBuild,
  accessToken: string,
): Promise<CommunityBuildDetail> {
  // Prefer POST upsert: creates when the id is new, updates draft/rejected rows.
  const res = await fetch(
    isUuid(build.id) ? `/api/builds/${build.id}` : "/api/builds",
    {
      method: isUuid(build.id) ? "PATCH" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await authHeaders(accessToken)),
      },
      body: JSON.stringify({ build }),
    },
  );
  // If a stale UUID isn't on the server yet, fall back to create.
  if (res.status === 404 && isUuid(build.id)) {
    const createRes = await fetch("/api/builds", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await authHeaders(accessToken)),
      },
      body: JSON.stringify({ build }),
    });
    if (!createRes.ok) throw new Error(await readError(createRes));
    const created = (await createRes.json()) as { build: CommunityBuildDetail };
    return created.build;
  }
  if (!res.ok) throw new Error(await readError(res));
  const json = (await res.json()) as { build: CommunityBuildDetail };
  return json.build;
}

export async function submitBuild(
  id: string,
  accessToken: string,
): Promise<CommunityBuildDetail> {
  const res = await fetch(`/api/builds/${id}/submit`, {
    method: "POST",
    headers: await authHeaders(accessToken),
  });
  if (!res.ok) throw new Error(await readError(res));
  const json = (await res.json()) as { build: CommunityBuildDetail };
  return json.build;
}

export async function reviewBuild(
  id: string,
  action: "approve" | "reject",
  accessToken: string,
): Promise<CommunityBuildDetail> {
  const res = await fetch(`/api/builds/${id}/review`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders(accessToken)),
    },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const json = (await res.json()) as { build: CommunityBuildDetail };
  return json.build;
}

export async function fetchPendingBuilds(
  accessToken: string,
): Promise<CommunityBuildDetail[]> {
  const res = await fetch("/api/builds/review", {
    headers: await authHeaders(accessToken),
  });
  if (!res.ok) throw new Error(await readError(res));
  const json = (await res.json()) as { builds: CommunityBuildDetail[] };
  return json.builds;
}

export async function toggleBuildVote(
  id: string,
  accessToken: string,
): Promise<{ upvoteCount: number; viewerHasVoted: boolean }> {
  const res = await fetch(`/api/builds/${id}/vote`, {
    method: "POST",
    headers: await authHeaders(accessToken),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as { upvoteCount: number; viewerHasVoted: boolean };
}

export async function fetchBuildComments(id: string) {
  const res = await fetch(`/api/builds/${id}/comments`);
  if (!res.ok) throw new Error(await readError(res));
  const json = (await res.json()) as {
    comments: import("@/lib/builds/types").CommunityBuildComment[];
  };
  return json.comments;
}

export async function postBuildComment(
  id: string,
  body: string,
  accessToken: string,
) {
  const res = await fetch(`/api/builds/${id}/comments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders(accessToken)),
    },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const json = (await res.json()) as {
    comment: import("@/lib/builds/types").CommunityBuildComment;
  };
  return json.comment;
}
