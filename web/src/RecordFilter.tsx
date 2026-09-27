import { useId, useState } from "react";

const normalize = (text: string) => text.normalize("NFKC").toLocaleLowerCase().trim();

export function useRecordFilter<T>({ items, label, fields, facets = [] }: {
  items: T[];
  label: string;
  fields: (item: T) => (string | undefined)[];
  facets?: { label: string; value: (item: T) => string | undefined }[];
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<string, string>>({});
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  const active = !!query || Object.values(selected).some(Boolean);
  const shown = items.filter((item) => {
    const text = normalize(fields(item).filter(Boolean).join(" "));
    return tokens.every((token) => text.includes(token)) && facets.every((facet) =>
      !selected[facet.label] || facet.value(item) === selected[facet.label]);
  });
  const reset = () => { setQuery(""); setSelected({}); };
  const controls = <div className="record-filter" role="search" aria-label={`${label}の検索と絞り込み`}>
    <label className="record-search" htmlFor={id}>{label}を検索
      <input id={id} type="search" value={query} placeholder="キーワード・名前で検索"
        onChange={(event) => setQuery(event.target.value)} />
    </label>
    {facets.map((facet) => {
      const options = [...new Set(items.map(facet.value).filter((value): value is string => !!value))];
      const value = selected[facet.label] ?? "";
      // Preserve a selected option if its last matching record disappears.
      if (value && !options.includes(value)) options.push(value);
      return <label key={facet.label}>{facet.label}
        <select aria-label={`${label}の絞り込み：${facet.label}`} value={value}
          onChange={(event) => setSelected((prev) => ({ ...prev, [facet.label]: event.target.value }))}>
          <option value="">すべて</option>
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>;
    })}
    <div className="record-filter-result">
      <span className="small muted" role="status">表示 {shown.length} / 全 {items.length} 件</span>
      {active && <button className="ghost small-btn" onClick={reset}>絞り込みを解除</button>}
    </div>
    {items.length > 0 && shown.length === 0 && <p className="small muted">条件に一致する項目がありません。検索語や絞り込みを変更してください。</p>}
  </div>;
  return { shown, controls };
}
