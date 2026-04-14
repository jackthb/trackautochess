import { useState, useRef, useEffect } from "react";

// ── Generic counted tag picker (used for lineup + synergies) ────────────────

export interface CountedTag {
  name: string;
  count: number;
}

interface CountedTagPickerProps {
  tags: CountedTag[];
  onChange: (tags: CountedTag[]) => void;
  suggestions: string[];
  iconPrefix: string;
  iconStem: (name: string) => string;
  placeholder?: string;
  countLabel?: string;
  minCount?: number;
  maxCount?: number;
  defaultCount?: number;
}

export function CountedTagPicker({
  tags,
  onChange,
  suggestions,
  iconPrefix,
  iconStem,
  placeholder,
  countLabel,
  minCount = 1,
  maxCount = 20,
  defaultCount = 1,
}: CountedTagPickerProps) {
  const [query, setQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const currentNames = tags.map((t) => t.name);
  const filtered = query
    ? suggestions
        .filter(
          (s) =>
            s.toLowerCase().includes(query.toLowerCase()) &&
            !currentNames.includes(s)
        )
        .slice(0, 8)
    : [];

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function add(name: string) {
    if (!currentNames.includes(name)) {
      onChange([...tags, { name, count: defaultCount }]);
    }
    setQuery("");
    setShowSuggestions(false);
    inputRef.current?.focus();
  }

  function remove(name: string) {
    onChange(tags.filter((t) => t.name !== name));
  }

  function updateCount(name: string, count: number) {
    const clamped = Math.max(minCount, Math.min(maxCount, count));
    onChange(tags.map((t) => (t.name === name ? { ...t, count: clamped } : t)));
  }

  return (
    <div className="tag-picker" ref={wrapRef}>
      <div className="tag-picker-tags">
        {tags.map((t) => (
          <span key={t.name} className="tag-chip">
            <img
              className="tag-chip-icon"
              src={`icons://${iconPrefix}/${iconStem(t.name)}.png`}
              alt=""
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
            <span className="tag-chip-name">{t.name}</span>
            <input
              className="tag-chip-count"
              type="number"
              min={minCount}
              max={maxCount}
              value={t.count}
              title={countLabel}
              onChange={(e) =>
                updateCount(t.name, parseInt(e.target.value) || defaultCount)
              }
              onClick={(e) => e.stopPropagation()}
            />
            <button className="tag-chip-remove" onClick={() => remove(t.name)}>
              &times;
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="tag-picker-input"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          placeholder={tags.length === 0 ? placeholder : ""}
        />
      </div>
      {showSuggestions && filtered.length > 0 && (
        <div className="tag-picker-dropdown">
          {filtered.map((s) => (
            <button
              key={s}
              className="tag-picker-option"
              onClick={() => add(s)}
            >
              <img
                className="tag-picker-option-icon"
                src={`icons://${iconPrefix}/${iconStem(s)}.png`}
                alt=""
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Reorderable tag picker (for relics) ─────────────────────────────────────

interface ReorderableTagPickerProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];
  iconPrefix: string;
  iconStem: (name: string) => string;
  placeholder?: string;
}

export function ReorderableTagPicker({
  tags,
  onChange,
  suggestions,
  iconPrefix,
  iconStem,
  placeholder,
}: ReorderableTagPickerProps) {
  const [query, setQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const filtered = query
    ? suggestions
        .filter(
          (s) =>
            s.toLowerCase().includes(query.toLowerCase()) && !tags.includes(s)
        )
        .slice(0, 8)
    : [];

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function add(name: string) {
    if (!tags.includes(name)) onChange([...tags, name]);
    setQuery("");
    setShowSuggestions(false);
    inputRef.current?.focus();
  }

  function remove(name: string) {
    onChange(tags.filter((t) => t !== name));
  }

  function moveUp(idx: number) {
    if (idx <= 0) return;
    const next = [...tags];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    onChange(next);
  }

  function moveDown(idx: number) {
    if (idx >= tags.length - 1) return;
    const next = [...tags];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    onChange(next);
  }

  return (
    <div className="tag-picker" ref={wrapRef}>
      <div className="tag-picker-tags">
        {tags.map((t, i) => (
          <span key={t} className="tag-chip">
            <img
              className="tag-chip-icon"
              src={`icons://${iconPrefix}/${iconStem(t)}.png`}
              alt=""
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
            <span className="tag-chip-name">{t}</span>
            {tags.length > 1 && (
              <span className="tag-chip-arrows">
                <button
                  className="tag-chip-arrow"
                  onClick={() => moveUp(i)}
                  disabled={i === 0}
                >
                  &#9664;
                </button>
                <button
                  className="tag-chip-arrow"
                  onClick={() => moveDown(i)}
                  disabled={i === tags.length - 1}
                >
                  &#9654;
                </button>
              </span>
            )}
            <button className="tag-chip-remove" onClick={() => remove(t)}>
              &times;
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="tag-picker-input"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          placeholder={tags.length === 0 ? placeholder : ""}
        />
      </div>
      {showSuggestions && filtered.length > 0 && (
        <div className="tag-picker-dropdown">
          {filtered.map((s) => (
            <button
              key={s}
              className="tag-picker-option"
              onClick={() => add(s)}
            >
              <img
                className="tag-picker-option-icon"
                src={`icons://${iconPrefix}/${iconStem(s)}.png`}
                alt=""
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
