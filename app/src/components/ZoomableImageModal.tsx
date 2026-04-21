import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface ZoomableImageModalProps {
  src: string;
  alt: string;
  onClose: () => void;
}

export function ZoomableImageModal({
  src,
  alt,
  onClose,
}: ZoomableImageModalProps) {
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(z + 0.25, 5));
      if (e.key === "-") setZoom((z) => Math.max(z - 0.25, 0.5));
      if (e.key === "0") setZoom(1);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="screenshot-lightbox" onClick={onClose}>
      <div className="zoom-lightbox-toolbar" onClick={(e) => e.stopPropagation()}>
        <button className="btn-ss-small" onClick={() => setZoom((z) => Math.max(z - 0.25, 0.5))}>
          -
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button className="btn-ss-small" onClick={() => setZoom((z) => Math.min(z + 0.25, 5))}>
          +
        </button>
        <button className="btn-ss-small" onClick={() => setZoom(1)}>
          Reset
        </button>
      </div>
      <div className="zoom-lightbox-stage" onClick={(e) => e.stopPropagation()}>
        <img
          className="screenshot-lightbox-img zoom-lightbox-img"
          src={src}
          alt={alt}
          style={{ transform: `scale(${zoom})` }}
          onWheel={(e) => {
            e.preventDefault();
            setZoom((z) => {
              const next = e.deltaY < 0 ? z + 0.15 : z - 0.15;
              return Math.min(Math.max(next, 0.5), 5);
            });
          }}
        />
      </div>
      <button className="screenshot-lightbox-close" onClick={onClose}>
        &times;
      </button>
    </div>,
    document.body
  );
}
