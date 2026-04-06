import { useState, useEffect, useCallback } from "react";
import type { Screenshot } from "../types";

interface ScreenshotHistoryProps {
  /** Called when user wants to re-import a screenshot file */
  onImportFile?: (path: string) => void;
}

export function ScreenshotHistory({ onImportFile }: ScreenshotHistoryProps) {
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const [thumbnailCache, setThumbnailCache] = useState<
    Record<string, string>
  >({});
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await window.screenshots.list();
      setScreenshots(list);
    } catch {
      setScreenshots([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const loadThumbnail = useCallback(
    async (name: string) => {
      if (thumbnailCache[name]) return;
      const data = await window.screenshots.thumbnail(name);
      if (data) {
        setThumbnailCache((prev) => ({ ...prev, [name]: data }));
      }
    },
    [thumbnailCache]
  );

  const handleDelete = async (name: string) => {
    const ok = await window.screenshots.delete(name);
    if (ok) {
      setScreenshots((prev) => prev.filter((s) => s.name !== name));
      setDeleteConfirm(null);
      if (expandedImage === name) setExpandedImage(null);
    }
  };

  const handleExpand = async (name: string) => {
    if (expandedImage === name) {
      setExpandedImage(null);
      return;
    }
    if (!thumbnailCache[name]) {
      await loadThumbnail(name);
    }
    setExpandedImage(name);
  };

  const formatDate = (mtime: number) => {
    const d = new Date(mtime);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }) + " " + d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (loading) {
    return (
      <div className="ss-history">
        <div className="ss-history-header">
          <h3>Screenshot History</h3>
        </div>
        <div className="ss-history-loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="ss-history">
      <div className="ss-history-header">
        <h3>Screenshot History</h3>
        <div className="ss-history-actions">
          <button className="btn-ss-action" onClick={() => window.screenshots.openFolder()}>
            Open Folder
          </button>
          <button className="btn-ss-action" onClick={refresh}>
            Refresh
          </button>
        </div>
      </div>

      {screenshots.length === 0 ? (
        <div className="ss-history-empty">
          No screenshots yet. Capture a screenshot (F6) to get started.
        </div>
      ) : (
        <div className="ss-history-list">
          {screenshots.map((ss) => (
            <div key={ss.name} className="ss-item">
              <div className="ss-item-row" onClick={() => handleExpand(ss.name)}>
                <div className="ss-item-info">
                  <span className="ss-item-name">
                    {ss.uploaded && <span className="ss-uploaded-badge" title="Uploaded to database">&#10003;</span>}
                    {ss.name}
                  </span>
                  <span className="ss-item-meta">
                    {formatDate(ss.mtime)} &middot; {formatSize(ss.size)}
                  </span>
                </div>
                <div className="ss-item-buttons">
                  {onImportFile && (
                    <button
                      className="btn-ss-small"
                      title="Import this screenshot"
                      onClick={(e) => {
                        e.stopPropagation();
                        onImportFile(ss.path);
                      }}
                    >
                      Import
                    </button>
                  )}
                  {deleteConfirm === ss.name ? (
                    <>
                      <button
                        className="btn-ss-small btn-ss-danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(ss.name);
                        }}
                      >
                        Confirm
                      </button>
                      <button
                        className="btn-ss-small"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirm(null);
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn-ss-small btn-ss-danger"
                      title="Delete screenshot"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirm(ss.name);
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
              {expandedImage === ss.name && thumbnailCache[ss.name] && (
                <div className="ss-item-preview">
                  <img src={thumbnailCache[ss.name]} alt={ss.name} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
