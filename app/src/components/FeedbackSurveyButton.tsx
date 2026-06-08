import { useCallback, useEffect, useState } from "react";
import { capture, getPostHog } from "../lib/posthog";
import type { TrackerStatus } from "../types";

type PostHogSurvey = {
  id: string;
  name?: string;
  description?: string;
  type?: string;
  start_date?: string | null;
  end_date?: string | null;
  archived?: boolean;
};

interface FeedbackSurveyButtonProps {
  status: TrackerStatus | null;
}

export function FeedbackSurveyButton({ status }: FeedbackSurveyButtonProps) {
  const [version, setVersion] = useState<string | null>(null);
  const [surveyId, setSurveyId] = useState<string | null>(
    import.meta.env.VITE_POSTHOG_FEEDBACK_SURVEY_ID?.trim() || null,
  );
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.appApi
      .getVersion()
      .then((appVersion) => {
        if (!cancelled) setVersion(appVersion);
      })
      .catch(() => {
        if (!cancelled) setVersion(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const configuredSurveyId = import.meta.env.VITE_POSTHOG_FEEDBACK_SURVEY_ID?.trim();
    if (configuredSurveyId) {
      setSurveyId(configuredSurveyId);
      return;
    }

    let cancelled = false;
    void getPostHog().then((posthog) => {
      if (!posthog || cancelled) return;
      posthog.getActiveMatchingSurveys((surveys, context) => {
        if (cancelled) return;
        const activeSurvey = pickFeedbackSurvey(surveys);
        if (activeSurvey) {
          setSurveyId(activeSurvey.id);
          setMessage(null);
          return;
        }
        posthog.getSurveys((allSurveys, allContext) => {
          if (cancelled) return;
          const fallbackSurvey = pickFeedbackSurvey(allSurveys);
          if (fallbackSurvey) {
            setSurveyId(fallbackSurvey.id);
            setMessage(null);
            return;
          }
          setSurveyId(null);
          setMessage(null);
        }, true);
      }, true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const showSurvey = useCallback(() => {
    setLoading(true);
    setMessage(null);
    void getPostHog().then((posthog) => {
      if (!posthog) {
        setLoading(false);
        setMessage("Feedback is unavailable in this build.");
        return;
      }

      const display = (id: string) => {
        posthog.displaySurvey(id, {
          displayType: "popover",
          ignoreConditions: true,
          ignoreDelay: true,
          properties: {
            app_version: version,
            steam_id: status?.steam_id ?? null,
            steam_name: status?.steam_name ?? null,
            source: "desktop_app_feedback_popup",
          },
        });
        capture("feedback_survey_opened", { survey_id: id });
        setLoading(false);
      };

      if (surveyId) {
        display(surveyId);
        return;
      }

      posthog.getSurveys((surveys, context) => {
        const survey = pickFeedbackSurvey(surveys);
        if (survey) {
          setSurveyId(survey.id);
          display(survey.id);
          return;
        }
        setLoading(false);
        setMessage(context?.error ? "Feedback failed to load." : "No feedback survey is active.");
      }, true);
    });
  }, [status?.steam_id, status?.steam_name, surveyId, version]);

  return (
    <div className="feedback-survey-global">
      <button
        type="button"
        className={`feedback-survey-button${loading ? " btn-loading" : ""}`}
        onClick={showSurvey}
        disabled={loading}
      >
        {loading ? "Opening…" : "Feedback"}
      </button>
      {message && <div className="feedback-survey-message">{message}</div>}
    </div>
  );
}

function pickFeedbackSurvey(surveys: PostHogSurvey[]): PostHogSurvey | null {
  const live = surveys.filter((survey) => {
    if (!survey.id || survey.archived) return false;
    if (survey.start_date === undefined) return true;
    if (!survey.start_date) return false;
    if (survey.end_date && Date.parse(survey.end_date) <= Date.now()) return false;
    return true;
  });

  return (
    live.find((survey) => {
      const haystack = `${survey.name ?? ""} ${survey.description ?? ""}`.toLowerCase();
      return haystack.includes("feedback") || haystack.includes("desktop");
    }) ??
    live.find((survey) => survey.type === "api" || survey.type === "popover") ??
    live[0] ??
    null
  );
}
