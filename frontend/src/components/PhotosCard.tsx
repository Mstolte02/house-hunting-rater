import { useEffect, useRef, useState } from "react";

import { api } from "../lib/api";

/** Pull image URLs out of a drop — dragging a photo from a listing tab lands here. */
function urlsFromDrop(dt: DataTransfer): string[] {
  const raw =
    dt.getData("text/uri-list") || dt.getData("text/plain") || "";
  return raw
    .split(/[\r\n]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));
}

/**
 * Photo upload for a property.
 *
 * Three ways in: choose files, drag an image straight out of a listing tab, or paste an
 * image URL (right-click → Copy Image Address). Whichever you use, the file ends up
 * stored locally under data/photos/, so it survives the listing being edited or pulled.
 *
 * Works with or without a saved property. On the Add form there is no id yet, so files
 * and URLs are held until the property is created — otherwise you'd have to save, come
 * back, and re-find the photos you already had open.
 */
export default function PhotosCard({
  propertyId,
  onPending,
  onPendingUrls,
  compact = false,
}: {
  propertyId?: number;
  onPending?: (files: File[]) => void;
  onPendingUrls?: (urls: string[]) => void;
  compact?: boolean;
}) {
  const [photos, setPhotos] = useState<{ name: string; url: string }[]>([]);
  const [pending, setPending] = useState<{ file: File; url: string }[]>([]);
  const [pendingUrls, setPendingUrls] = useState<string[]>([]);
  const [urlDraft, setUrlDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function refresh() {
    if (!propertyId) return;
    setPhotos(await api.photos(propertyId));
  }

  useEffect(() => {
    refresh().catch(() => setPhotos([]));
  }, [propertyId]);

  // Object URLs for the local previews have to be released or they leak.
  useEffect(
    () => () => pending.forEach((p) => URL.revokeObjectURL(p.url)),
    [pending]
  );

  async function acceptFiles(files: FileList | File[] | null) {
    const list = files ? Array.from(files) : [];
    if (!list.length) return;

    if (!propertyId) {
      const next = [...pending, ...list.map((f) => ({ file: f, url: URL.createObjectURL(f) }))];
      setPending(next);
      onPending?.(next.map((p) => p.file));
      if (input.current) input.current.value = "";
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await api.uploadPhotos(propertyId, list);
      await refresh();
    } catch (e: any) {
      setError(String(e.message));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function acceptUrls(urls: string[]) {
    if (!urls.length) return;

    if (!propertyId) {
      const next = [...pendingUrls, ...urls];
      setPendingUrls(next);
      onPendingUrls?.(next);
      setUrlDraft("");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const r = await api.addPhotosFromUrl(propertyId, urls);
      if (r.failed.length) {
        setError(
          `Saved ${r.saved}. Skipped ${r.failed.length}: ${r.failed[0].reason}`
        );
      }
      setUrlDraft("");
      await refresh();
    } catch (e: any) {
      setError(String(e.message));
    } finally {
      setBusy(false);
    }
  }

  function dropPending(i: number) {
    const next = pending.filter((_, j) => j !== i);
    URL.revokeObjectURL(pending[i].url);
    setPending(next);
    onPending?.(next.map((p) => p.file));
  }

  function dropPendingUrl(i: number) {
    const next = pendingUrls.filter((_, j) => j !== i);
    setPendingUrls(next);
    onPendingUrls?.(next);
  }

  const stored = propertyId ? photos : [];
  const queuedFiles = propertyId ? [] : pending;
  const totalQueued = queuedFiles.length + (propertyId ? 0 : pendingUrls.length);

  return (
    <section className={compact ? "" : "card plain"}>
      {!compact && <div className="section-title">Photos</div>}
      {error && <div className="err" style={{ marginBottom: 16 }}>{error}</div>}

      {(stored.length > 0 || totalQueued > 0) && (
        <div className="photo-grid" style={{ marginBottom: 18 }}>
          {stored.map((ph) => (
            <div className="photo" key={ph.name}>
              <a href={ph.url} target="_blank" rel="noreferrer">
                <img src={ph.url} alt="" loading="lazy" />
              </a>
              <button
                title="Remove"
                onClick={async () => {
                  await api.deletePhoto(propertyId!, ph.name);
                  await refresh();
                }}
              >
                ✕
              </button>
            </div>
          ))}
          {queuedFiles.map((p, i) => (
            <div className="photo" key={`f${i}`}>
              <img src={p.url} alt="" />
              <button title="Remove" onClick={() => dropPending(i)}>✕</button>
            </div>
          ))}
          {!propertyId &&
            pendingUrls.map((u, i) => (
              <div className="photo" key={`u${i}`}>
                <img src={u} alt="" />
                <button title="Remove" onClick={() => dropPendingUrl(i)}>✕</button>
              </div>
            ))}
        </div>
      )}

      <div
        className="dropzone"
        onClick={() => input.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files?.length) return acceptFiles(e.dataTransfer.files);
          acceptUrls(urlsFromDrop(e.dataTransfer));
        }}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files ?? []);
          if (files.length) return acceptFiles(files);
          const text = e.clipboardData.getData("text");
          if (/^https?:\/\//i.test(text.trim())) acceptUrls([text.trim()]);
        }}
      >
        {busy
          ? "Saving…"
          : stored.length || totalQueued
          ? "Add more — drop files, or drag an image from a listing"
          : "Drop photos here, drag an image from a listing, or click to choose"}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => acceptFiles(e.target.files)}
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, marginTop: 14 }}>
        <input
          value={urlDraft}
          placeholder="…or paste an image address"
          onChange={(e) => setUrlDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              acceptUrls([urlDraft.trim()].filter((u) => /^https?:\/\//i.test(u)));
            }
          }}
        />
        <button
          type="button"
          className="btn sm"
          disabled={busy || !/^https?:\/\//i.test(urlDraft.trim())}
          onClick={() => acceptUrls([urlDraft.trim()])}
        >
          Add
        </button>
      </div>

      <div className="tiny faint" style={{ marginTop: 12 }}>
        {propertyId
          ? "Saved in this browser. Published photos come from the repository snapshot."
          : totalQueued
          ? `${totalQueued} photo${totalQueued === 1 ? "" : "s"} will be saved when you add the property.`
          : "Saved to this machine — the image is copied, so it survives the listing changing."}
      </div>
    </section>
  );
}
