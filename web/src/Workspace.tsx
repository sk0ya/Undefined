import { useId, useState, type ReactNode } from "react";

export type WorkspaceItem = { id: string; label: string; description?: string; badge?: number; content: ReactNode };

/** Keep visited workspaces mounted so switching tasks never discards a draft. */
export function Workspace({ items, label }: { items: WorkspaceItem[]; label: string }) {
  const [active, setActive] = useState(items[0]?.id);
  const [visited, setVisited] = useState(() => new Set([items[0]?.id]));
  const prefix = useId();
  const current = items.find((item) => item.id === active) ?? items[0];
  return (
    <div className="workspace">
      <nav className="workspace-nav" aria-label={label}>
        {items.map((item) => (
          <button key={item.id} aria-pressed={item.id === current?.id}
            aria-controls={`${prefix}-${item.id}`} onClick={() => {
              setActive(item.id);
              setVisited((prev) => new Set(prev).add(item.id));
            }}>
            <span>{item.label}{!!item.badge && <span className="workspace-count">{item.badge}</span>}</span>
            {item.description && <small>{item.description}</small>}
          </button>
        ))}
      </nav>
      <div className="workspace-body">
        {items.map((item) => (
          <section key={item.id} id={`${prefix}-${item.id}`} hidden={item.id !== current?.id} aria-label={item.label}>
            {(visited.has(item.id) || item.id === current?.id) && item.content}
          </section>
        ))}
      </div>
    </div>
  );
}
