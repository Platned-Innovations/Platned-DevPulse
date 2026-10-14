"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

interface Props {
  platforms: { value: string; label: string }[];
  repos: { value: string; label: string }[];
  showRepo?: boolean;
}

/** Platform and project selectors; changes navigate immediately, keeping the period. */
export function FilterBar({ platforms, repos, showRepo = true }: Props) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();

  const set = (key: string, value: string) => {
    const p = new URLSearchParams(sp.toString());
    if (value) p.set(key, value);
    else p.delete(key);
    const s = p.toString();
    router.push(s ? `${path}?${s}` : path);
  };

  return (
    <div className="row">
      {platforms.length > 1 && (
        <label className="row" style={{ gap: 6 }}>
          <span className="muted">Platform</span>
          <select value={sp.get("platform") ?? ""} onChange={(e) => set("platform", e.target.value)}>
            <option value="">All (combined)</option>
            {platforms.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </label>
      )}
      {showRepo && repos.length > 0 && (
        <label className="row" style={{ gap: 6 }}>
          <span className="muted">Project</span>
          <select value={sp.get("repo") ?? ""} onChange={(e) => set("repo", e.target.value)}>
            <option value="">All projects</option>
            {repos.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
