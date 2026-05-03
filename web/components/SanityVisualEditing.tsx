import { useEffect, useState } from "react";
import { VisualEditing } from "@sanity/visual-editing/next-pages-router";
import { useLiveMode } from "@sanity/react-loader";
import { client } from "@/lib/sanity/client";

const stegaClient = client.withConfig({ stega: true });

function DisableDraftMode() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(window.top === window);
  }, []);

  if (!show) return null;
  return (
    <a
      href="/api/draft/disable"
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        zIndex: 9999,
        background: "#222",
        color: "#fff",
        padding: "8px 12px",
        borderRadius: 6,
        fontSize: 12,
        textDecoration: "none",
        border: "1px solid #444",
      }}
    >
      Disable Draft Mode
    </a>
  );
}

export default function SanityVisualEditing() {
  useLiveMode({ client: stegaClient });
  return (
    <>
      <VisualEditing />
      <DisableDraftMode />
    </>
  );
}
