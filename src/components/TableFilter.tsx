"use client";

import { useEffect, useState } from "react";

interface FilterDef {
  /** Matches the row attribute `data-<key>` (space-separated tokens). */
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

interface Props {
  /** id of the <table> whose body rows are filtered. Rows carry `data-search` and `data-<filter key>`. */
  tableId: string;
  placeholder: string;
  filters?: FilterDef[];
  noun: string;
}

/**
 * Search box and dropdown filters for a server-rendered table. Filtering happens in the browser by
 * hiding rows, so it is instant and does not touch the server or lose the row's forms.
 */
export function TableFilter({ tableId, placeholder, filters = [], noun }: Props) {
  const [query, setQuery] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [counts, setCounts] = useState({ shown: 0, total: 0 });

  useEffect(() => {
    const table = document.getElementById(tableId);
    const body = table?.querySelector("tbody");
    if (!body) return;
    const q = query.trim().toLowerCase();

    const apply = () => {
      let shown = 0;
      const rows = Array.from(body.querySelectorAll<HTMLTableRowElement>(":scope > tr"));
      for (const tr of rows) {
        const matchesText = !q || (tr.dataset.search ?? "").includes(q);
        const matchesFilters = filters.every((f) => {
          const want = values[f.key];
          return !want || (tr.dataset[f.key] ?? "").split(" ").includes(want);
        });
        const visible = matchesText && matchesFilters;
        if (tr.hidden === visible) tr.hidden = !visible;
        if (visible) shown++;
      }
      setCounts((c) => (c.shown === shown && c.total === rows.length ? c : { shown, total: rows.length }));
    };

    apply();
    // Rows are re-rendered by the server after actions (rename, merge, sync...): keep the filter applied.
    const observer = new MutationObserver(apply);
    observer.observe(body, { childList: true });
    return () => observer.disconnect();
  }, [tableId, query, values, filters]);

  const active = query.trim() !== "" || Object.values(values).some(Boolean);

  return (
    <div className="filters">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="filter-search"
      />
      {filters.map((f) => (
        <label key={f.key} className="row" style={{ gap: 6 }}>
          <span className="muted">{f.label}</span>
          <select value={values[f.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}>
            <option value="">All</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      ))}
      {active && (
        <button
          type="button"
          onClick={() => {
            setQuery("");
            setValues({});
          }}
        >
          Clear
        </button>
      )}
      <span className="faint" style={{ fontSize: 13, marginLeft: "auto" }} aria-live="polite">
        Showing {counts.shown} of {counts.total} {noun}
      </span>
      {counts.total > 0 && counts.shown === 0 && <span className="muted" style={{ flexBasis: "100%" }}>No {noun} match these filters.</span>}
    </div>
  );
}
