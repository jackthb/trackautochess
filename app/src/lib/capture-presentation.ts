/** Only explicit backend evidence can claim a saved result. Leaving Dota is not completion. */
export function capturePresentation(phase: string | null | undefined) {
  switch (phase) {
    case "checking": return {
      title: "Checking for a final result",
      detail: "Keeping your captured progress while we check whether a final result is available.",
    };
    case "interrupted": return {
      title: "Match interrupted",
      detail: "Waiting for you to rejoin. Your captured progress is being held; the match may still be running.",
    };
    case "uploading": return {
      title: "Uploading result",
      detail: "Saving the last captured standings as an incomplete result.",
    };
    case "retrying": return {
      title: "Upload pending",
      detail: "The result has not been confirmed online. Upload will be retried automatically.",
    };
    case "saved_partial": return {
      title: "Saved — incomplete",
      detail: "Last-known standings were saved. A final result was not captured.",
    };
    case "saved_complete": return {
      title: "Saved — complete",
      detail: "The final result was saved. Round history includes only the rounds captured by the tracker.",
    };
    case "unavailable": return {
      title: "No result captured",
      detail: "There was no usable snapshot to save for this match.",
    };
    default: return null;
  }
}
