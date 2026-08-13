/**
 * Local photo storage. Files land in data/photos/{property-id}/ as plain images on
 * disk — no cloud bucket, no base64 blobs in the database. Deleting a property leaves
 * its folder behind harmlessly; deleting a photo removes the file.
 */

import { Router } from "express";
import multer from "multer";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

import { DATA_DIR } from "../db/index.js";

export const PHOTO_DIR = join(DATA_DIR, "photos");
mkdirSync(PHOTO_DIR, { recursive: true });

const ALLOWED = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".avif"]);

/** Content-type -> extension, for images fetched by URL where the path has no suffix. */
const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "image/heic": ".heic",
};

/** Loopback, link-local and RFC1918 space — never fetched on a pasted URL's say-so. */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80:")) {
    return true;
  }
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 || a === 127 || a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

const storage = multer.diskStorage({
  destination(req, _file, cb) {
    const dir = join(PHOTO_DIR, String(Number(req.params.id)));
    mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(_req, file, cb) {
    const ext = extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024, files: 12 },
  fileFilter(_req, file, cb) {
    cb(null, ALLOWED.has(extname(file.originalname).toLowerCase()));
  },
});

export const photos = Router();

/** First photo for a property, or null. Used as the lead image on listings. */
export function leadPhoto(propertyId: number): string | null {
  const dir = join(PHOTO_DIR, String(propertyId));
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => ALLOWED.has(extname(f).toLowerCase()))
    .sort();
  return files.length
    ? `/api/properties/${propertyId}/photos/${encodeURIComponent(files[0])}`
    : null;
}

/** Guards against a crafted id escaping the photo directory. */
function dirFor(id: unknown): string | null {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  const dir = join(PHOTO_DIR, String(n));
  return resolve(dir).startsWith(resolve(PHOTO_DIR)) ? dir : null;
}

/**
 * Save photos from image URLs you supply — drag an image out of a listing tab, or
 * right-click → Copy Image Address and paste it.
 *
 * Deliberately NOT a listing scraper. Zillow's listing pages sit behind bot protection
 * (a plain request returns 403 + captcha) and their robots.txt disallows the paths, so
 * pulling a gallery from a listing URL would mean defeating an access control. This
 * takes direct image URLs instead and stores the file locally, the same as an upload,
 * so photos stay put when the listing changes or expires.
 */
photos.post("/:id/photos/from-url", async (req, res) => {
  const dir = dirFor(req.params.id);
  if (!dir) return res.status(400).json({ error: "bad property id" });

  const urls: string[] = Array.isArray(req.body?.urls)
    ? req.body.urls.filter((u: unknown) => typeof u === "string")
    : [];
  if (!urls.length) return res.status(400).json({ error: "No image URLs supplied." });

  mkdirSync(dir, { recursive: true });
  const saved: string[] = [];
  const failed: { url: string; reason: string }[] = [];

  for (const raw of urls.slice(0, 12)) {
    try {
      const url = new URL(raw);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        failed.push({ url: raw, reason: "not an http(s) URL" });
        continue;
      }
      // The server would happily fetch localhost or a LAN address on request; refuse,
      // so a pasted URL can't be used to poke at anything on this machine's network.
      if (isPrivateHost(url.hostname)) {
        failed.push({ url: raw, reason: "refusing to fetch a private address" });
        continue;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      let resp: Response;
      try {
        resp = await fetch(url, {
          signal: controller.signal,
          headers: { "User-Agent": "housing-rater/1.0 (personal)" },
        });
      } finally {
        clearTimeout(timer);
      }

      if (!resp.ok) {
        failed.push({ url: raw, reason: `HTTP ${resp.status}` });
        continue;
      }
      const type = resp.headers.get("content-type") ?? "";
      if (!type.startsWith("image/")) {
        failed.push({ url: raw, reason: `not an image (${type || "unknown type"})` });
        continue;
      }

      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.byteLength > 15 * 1024 * 1024) {
        failed.push({ url: raw, reason: "larger than 15MB" });
        continue;
      }

      const ext =
        EXT_BY_TYPE[type.split(";")[0].trim()] ??
        (ALLOWED.has(extname(url.pathname).toLowerCase())
          ? extname(url.pathname).toLowerCase()
          : ".jpg");
      const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
      writeFileSync(join(dir, name), buf);
      saved.push(name);
    } catch (e: any) {
      failed.push({ url: raw, reason: String(e?.message ?? e) });
    }
  }

  if (!saved.length) {
    return res.status(400).json({
      error: failed[0]?.reason
        ? `Couldn't save that image: ${failed[0].reason}`
        : "Couldn't save those images.",
      failed,
    });
  }
  res.status(201).json({ saved: saved.length, failed });
});

photos.get("/:id/photos", (req, res) => {
  const dir = dirFor(req.params.id);
  if (!dir || !existsSync(dir)) return res.json([]);
  const files = readdirSync(dir)
    .filter((f) => ALLOWED.has(extname(f).toLowerCase()))
    .map((f) => ({
      name: f,
      url: `/api/properties/${Number(req.params.id)}/photos/${encodeURIComponent(f)}`,
      size: statSync(join(dir, f)).size,
    }));
  res.json(files);
});

photos.post("/:id/photos", upload.array("photos", 12), (req, res) => {
  const files = (req.files ?? []) as Express.Multer.File[];
  if (!files.length) {
    return res.status(400).json({ error: "No image files were accepted." });
  }
  res.status(201).json({ uploaded: files.length });
});

photos.get("/:id/photos/:name", (req, res) => {
  const dir = dirFor(req.params.id);
  if (!dir) return res.status(400).end();
  // basename strips any traversal attempt in the filename itself.
  const file = join(dir, req.params.name.replace(/[/\\]/g, ""));
  if (!resolve(file).startsWith(resolve(dir)) || !existsSync(file)) {
    return res.status(404).end();
  }
  res.sendFile(resolve(file));
});

photos.delete("/:id/photos/:name", (req, res) => {
  const dir = dirFor(req.params.id);
  if (!dir) return res.status(400).end();
  const file = join(dir, req.params.name.replace(/[/\\]/g, ""));
  if (resolve(file).startsWith(resolve(dir)) && existsSync(file)) rmSync(file);
  res.status(204).end();
});
