const STORAGE_PREFIX = 'frocia_preview_storage_v1_';
export const SANDBOX_STORAGE_MESSAGE = 'frocia:sandbox-storage:v1';

type StorageEntries = Record<string, string>;

function storageKey(siteId: string): string {
  return `${STORAGE_PREFIX}${siteId}`;
}

function readEntries(siteId: string): StorageEntries {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(siteId)) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([key, value]) => key.length <= 200 && typeof value === 'string')
        .slice(0, 250)
    ) as StorageEntries;
  } catch {
    return {};
  }
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function buildSandboxedSiteDocument(html: string, siteId: string): string {
  const initialEntries = readEntries(siteId);
  const bridge = `<script>(function(){
    const siteId=${safeJson(siteId)};
    let entries=${safeJson(initialEntries)};
    const persist=()=>window.parent.postMessage({type:${safeJson(SANDBOX_STORAGE_MESSAGE)},siteId:siteId,entries:entries},'*');
    const storage={
      get length(){return Object.keys(entries).length},
      key(index){return Object.keys(entries)[Number(index)]??null},
      getItem(key){key=String(key);return Object.prototype.hasOwnProperty.call(entries,key)?entries[key]:null},
      setItem(key,value){entries[String(key)]=String(value);persist()},
      removeItem(key){delete entries[String(key)];persist()},
      clear(){entries={};persist()}
    };
    try{Object.defineProperty(window,'localStorage',{value:storage,configurable:false})}catch(error){console.error('Froc.IA storage bridge unavailable',error)}
  })();</script>`;

  const headMatch = html.match(/<head(?:\s[^>]*)?>/i);
  if (headMatch?.index !== undefined) {
    const insertionPoint = headMatch.index + headMatch[0].length;
    return `${html.slice(0, insertionPoint)}${bridge}${html.slice(insertionPoint)}`;
  }
  return `${bridge}${html}`;
}

export function persistSandboxStorageMessage(
  data: unknown,
  expectedSiteId: string
): boolean {
  if (!data || typeof data !== 'object') return false;
  const message = data as { type?: unknown; siteId?: unknown; entries?: unknown };
  if (
    message.type !== SANDBOX_STORAGE_MESSAGE ||
    message.siteId !== expectedSiteId ||
    !message.entries ||
    typeof message.entries !== 'object' ||
    Array.isArray(message.entries)
  ) {
    return false;
  }

  const entries = Object.fromEntries(
    Object.entries(message.entries)
      .filter(([key, value]) => key.length <= 200 && typeof value === 'string')
      .slice(0, 250)
  );
  const serialized = JSON.stringify(entries);
  if (serialized.length > 1_000_000) return false;

  try {
    window.localStorage.setItem(storageKey(expectedSiteId), serialized);
    return true;
  } catch {
    return false;
  }
}
