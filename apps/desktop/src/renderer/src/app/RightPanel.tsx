import { useEffect, useMemo, useState } from 'react';
import { Button } from '@pm/ui';
import { SlidersHorizontal, MessageSquare, Save } from 'lucide-react';
import { useApp } from '../state/app-state';
import { ChatView } from './ChatView';
import { FIELDS, REF_FIELDS, type FieldSpec } from '../state/properties-schema';

type Mode = 'properties' | 'chat';

export function RightPanel() {
  const { activeTab, docData } = useApp();
  const [mode, setMode] = useState<Mode>('properties');
  const path = activeTab?.kind === 'doc' ? activeTab.path : null;
  const note = path ? docData[path]?.note ?? null : null;

  if (!note) {
    return (
      <div className="flex h-full flex-col border-l border-border bg-card/40">
        <div className="flex h-9 items-center border-b border-border px-4 text-sm font-medium text-muted-foreground">
          Context
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col border-l border-border bg-card/40">
      <div className="flex h-9 items-center gap-1 border-b border-border px-2">
        <button
          className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${
            mode === 'properties' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setMode('properties')}
        >
          <SlidersHorizontal className="size-3.5" /> Properties
        </button>
        <button
          className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${
            mode === 'chat' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setMode('chat')}
        >
          <MessageSquare className="size-3.5" /> Chat
        </button>
      </div>
      {mode === 'properties' ? (
        <PropertiesForm key={note.path} />
      ) : (
        <div className="min-h-0 flex-1">
          <ChatView
            key={`side-${note.path}`}
            sessionType="ask"
            scopeHint={`I'm looking at ${note.path} — "${note.title}". Answer with citations from the workspace.`}
          />
        </div>
      )}
    </div>
  );
}

function PropertiesForm() {
  const { activeTab, docData, saveFrontmatter } = useApp();
  const path = activeTab?.kind === 'doc' ? activeTab.path : null;
  const note = path ? docData[path]?.note ?? null : null;
  const initial = useMemo(() => ({ ...(note?.frontmatter ?? {}) }), [note?.frontmatter]);
  const [draft, setDraft] = useState<Record<string, unknown>>(initial);
  const [busy, setBusy] = useState(false);

  useEffect(() => setDraft(initial), [initial]);

  if (!note || !path) return null;
  const specs = FIELDS[note.type] ?? FIELDS.note;
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  const set = (key: string, value: unknown) =>
    setDraft((d) => {
      const next = { ...d };
      if (value === '' || value === undefined || (Array.isArray(value) && value.length === 0)) delete next[key];
      else next[key] = value;
      return next;
    });

  const onSave = async () => {
    setBusy(true);
    try {
      await saveFrontmatter(path, { ...draft, type: note.type });
    } finally {
      setBusy(false);
    }
  };

  const refs = REF_FIELDS.flatMap((k) => {
    const v = note.frontmatter[k];
    const arr = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
    return arr.map((r) => ({ key: k, ref: String(r) }));
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        {specs.map((spec) => (
          <FieldInput key={spec.key} spec={spec} value={draft[spec.key]} onChange={(v) => set(spec.key, v)} />
        ))}

        {refs.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Links</span>
            <div className="flex flex-wrap gap-1">
              {refs.map((r) => (
                <span key={`${r.key}:${r.ref}`} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {r.key}: {r.ref.replace(/^\[\[/, '').replace(/\]\]$/, '')}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="mt-1 text-[11px] text-muted-foreground">
          Modified {new Date(note.mtime).toLocaleString()}
        </div>
      </div>
      <div className="border-t border-border px-4 py-2">
        <Button size="sm" onClick={onSave} disabled={!dirty || busy} className="w-full">
          <Save className="size-3.5" /> Save properties
        </Button>
      </div>
    </div>
  );
}

function FieldInput({ spec, value, onChange }: { spec: FieldSpec; value: unknown; onChange: (v: unknown) => void }) {
  const label = (
    <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{spec.label}</span>
  );
  const inputClass =
    'rounded-md border border-input bg-card px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40';

  if (spec.widget === 'bool') {
    return (
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked || undefined)} />
        {label}
      </label>
    );
  }
  if (spec.widget === 'select') {
    return (
      <div className="flex flex-col gap-1">
        {label}
        <select className={inputClass} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">—</option>
          {spec.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    );
  }
  if (spec.widget === 'tags') {
    const arr = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="flex flex-col gap-1">
        {label}
        <input
          className={inputClass}
          value={arr.join(', ')}
          placeholder="comma, separated"
          onChange={(e) => onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
        />
      </div>
    );
  }
  if (spec.widget === 'textarea') {
    return (
      <div className="flex flex-col gap-1">
        {label}
        <textarea
          className={`${inputClass} min-h-16 resize-y`}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      {label}
      <input
        className={inputClass}
        type={spec.widget === 'date' ? 'date' : 'text'}
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
      />
    </div>
  );
}
