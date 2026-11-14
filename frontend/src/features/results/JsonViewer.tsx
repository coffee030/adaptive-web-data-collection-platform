import { useMemo, useRef, useState } from 'react';
import { Pagination } from '../../components/feedback';
import { CopyButton } from './presentation';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const chunkSize = 4096;

function characterBoundary(text: string, index: number) {
  const char = text.charCodeAt(index);
  return char >= 0xdc00 && char <= 0xdfff ? index - 1 : index;
}

export function JsonViewer({ value }: { value: JsonValue }) {
  const json = useMemo(() => JSON.stringify(value, null, 2), [value]);
  const [offset, setOffset] = useState(0);
  const region = useRef<HTMLPreElement>(null);
  const start = characterBoundary(json, offset);
  const end = characterBoundary(json, Math.min(offset + chunkSize, json.length));
  return (
    <section className="panel detail-panel" aria-labelledby="payload-title">
      <div className="panel-heading">
        <h2 id="payload-title" tabIndex={-1}>Record payload</h2>
        <CopyButton label="Copy JSON" read={() => json} />
      </div>
      <pre ref={region} className="record-json" tabIndex={0} role="region" aria-label="Record payload JSON"><code>{json.slice(start, end)}</code></pre>
      {json.length > chunkSize && (
        <Pagination label="JSON characters" offset={start} size={end - start} loaded={json.length - start}
          change={next => {
            region.current?.focus();
            if (region.current) region.current.scrollTop = 0;
            setOffset(next < start ? offset - chunkSize : offset + chunkSize);
          }} />
      )}
    </section>
  );
}
