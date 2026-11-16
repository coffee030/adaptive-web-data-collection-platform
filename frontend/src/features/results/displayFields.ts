import { useEffect, useState } from 'react';
import type { GenericRecord } from './api';
import { recordTitleFields } from './presentation';

interface FieldPreferences {
  available: string[];
  selection?: string[];
}

const preferred = ['summary', 'description', 'price', 'count'];
const maxScopes = 12;
const maxFields = 160;
const remembered = new Map<string, FieldPreferences>();
const empty: FieldPreferences = { available: [] };

function save(scope: string, value: FieldPreferences) {
  remembered.delete(scope);
  remembered.set(scope, value);
  if (remembered.size > maxScopes) remembered.delete(remembered.keys().next().value!);
}

function fieldsOnPage(rows: GenericRecord[]) {
  return [...new Set(rows.flatMap(record => Object.keys(record.payload)))].sort();
}

export function useDisplayFields(scope: string, rows: GenericRecord[]) {
  const [preferences, setPreferences] = useState(() => remembered.get(scope) ?? empty);
  const current = fieldsOnPage(rows);
  const available = [...new Set([...preferences.available, ...current])].slice(0, maxFields).sort();
  const defaults = [
    ...preferred.filter(field => available.includes(field)),
    ...available.filter(field => field !== 'dataset' && !preferred.includes(field)
      && !recordTitleFields.some(candidate => candidate === field)),
  ].slice(0, 3);
  const selected = preferences.selection ?? defaults;
  const availableKey = JSON.stringify(available);

  useEffect(() => {
    const names: string[] = JSON.parse(availableKey);
    if (names.length === preferences.available.length) return;
    const next = { ...preferences, available: names };
    save(scope, next);
    setPreferences(next);
  }, [scope, availableKey, preferences]);

  function select(selection?: string[]) {
    const next = { available, selection };
    save(scope, next);
    setPreferences(next);
  }

  return { available, selected, select, limitReached: available.length === maxFields };
}
