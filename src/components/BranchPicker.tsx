"use client";

import { useFormStatus } from "react-dom";
import { setBranchAction } from "@/app/admin/actions";

interface Props {
  repoId: string;
  /** Currently chosen branch, "" for automatic. */
  value: string;
  autoLabel: string;
  branches: { value: string; label: string }[];
}

function Select({ value, autoLabel, branches }: Omit<Props, "repoId">) {
  const { pending } = useFormStatus();
  return (
    <>
      <select
        name="branch"
        className="sel-branch"
        defaultValue={value}
        disabled={pending}
        aria-label="Branch to read"
        title="Commits are read from this branch, and pull requests that target it are counted. Saved when you pick one."
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        <option value="">Automatic ({autoLabel})</option>
        {branches.map((b) => (
          <option key={b.value} value={b.value}>{b.label}</option>
        ))}
      </select>
      {pending && <span className="faint" style={{ fontSize: 12 }}> Saving…</span>}
    </>
  );
}

/** Branch dropdown that saves as soon as a value is chosen (no separate Save button). */
export function BranchPicker({ repoId, ...rest }: Props) {
  return (
    <form action={setBranchAction}>
      <input type="hidden" name="id" value={repoId} />
      <Select {...rest} />
    </form>
  );
}
