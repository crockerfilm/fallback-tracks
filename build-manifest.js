#!/usr/bin/env node
/**
 * build-manifest.js
 * Scans /tracks for .txt metadata files → outputs manifest.json
 * Runs automatically via GitHub Actions on every push.
 */

const fs = require("fs");
const path = require("path");

const TRACKS_DIR = path.join(__dirname, "tracks");
const OUT_FILE = path.join(__dirname, "manifest.json");

function parseMetadata(text, filename) {
  const lines = text.split("\n");
  let title = "", artist = "", year = "", prompt = "", coverArt = "";
  let jsonLines = [], inRaw = false;

  for (const line of lines) {
    if (line.startsWith("Title:")) title = line.slice(6).trim();
    else if (line.startsWith("Artist:")) artist = line.slice(7).trim();
    else if (line.startsWith("Year:")) year = line.slice(5).trim();
    else if (line.startsWith("Prompt:")) prompt = line.slice(7).trim();
    else if (line.startsWith("Cover Art URL:")) coverArt = line.slice(14).trim();
    if (line.includes("--- Raw API Response ---")) { inRaw = true; continue; }
    if (inRaw) jsonLines.push(line);
  }

  let p = {};
  try { p = JSON.parse(jsonLines.join("\n")); } catch {}

  const id = p.id || path.basename(filename, ".txt").replace(/_mp3$/, "");
  const meta = p.metadata || {};
  const duration = meta.duration || 0;
  const createdAt = p.created_at || "";

  const displayTags = p.display_tags || "";
  const tags = meta.tags || prompt || "";

  const description = meta.gpt_description_prompt || "";
  const lyrics = meta.prompt || "";
  const isInstrumental = meta.make_instrumental || lyrics === "[Instrumental]";

  const bpmMatch = (tags + " " + description).match(/(\d{2,3})\s*bpm/i);
  const bpm = bpmMatch ? parseInt(bpmMatch[1]) : null;

  const moodMatch = prompt.match(/[.,]\s*([a-z, ]+)$/i);
  const moods = moodMatch
    ? moodMatch[1].split(",").map(s => s.trim()).filter(Boolean)
    : [];

  return {
    id,
    title: p.title || title || "Untitled",
    artist: p.display_name || artist || "Unknown",
    year: year || (createdAt ? new Date(createdAt).getFullYear().toString() : ""),
    duration,
    bpm,
    isInstrumental,
    moods,
    displayTags,
    tags,
    description,
    lyrics: isInstrumental ? null : lyrics,
    coverArt: p.image_url || coverArt,
    coverArtLarge: p.image_large_url || p.image_url || coverArt,
    audioUrl: p.audio_url || (p.media_urls && p.media_urls[1] && p.media_urls[1].url) || "",
    createdAt,
  };
}

// ── Run ──
console.log("\n⚡ Fallback Tracks — Building manifest...\n");

if (!fs.existsSync(TRACKS_DIR)) {
  fs.mkdirSync(TRACKS_DIR, { recursive: true });
  console.log("  Created /tracks/ directory (empty)");
}

const files = fs.readdirSync(TRACKS_DIR).filter(f => f.endsWith(".txt"));
console.log(`  Found ${files.length} metadata file(s)`);

const tracks = [];
const errors = [];

for (const file of files) {
  try {
    const content = fs.readFileSync(path.join(TRACKS_DIR, file), "utf-8");
    const track = parseMetadata(content, file);
    if (track && track.id) tracks.push(track);
    else errors.push({ file, reason: "Could not parse" });
  } catch (e) {
    errors.push({ file, reason: e.message });
  }
}

tracks.sort((a, b) => a.title.localeCompare(b.title));

const manifest = {
  trackCount: tracks.length,
  generatedAt: new Date().toISOString(),
  tracks,
};

fs.writeFileSync(OUT_FILE, JSON.stringify(manifest));

console.log(`  ✅ ${tracks.length} tracks → manifest.json (${(fs.statSync(OUT_FILE).size / 1024).toFixed(1)} KB)`);
if (errors.length) {
  console.log(`  ⚠️  ${errors.length} error(s):`);
  errors.forEach(e => console.log(`     - ${e.file}: ${e.reason}`));
}
console.log("");
