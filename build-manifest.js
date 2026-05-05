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
  const isInstrumental = meta.make_instrumental || (meta.prompt === "[Instrumental]");

  // ── Tags: split display_tags into individual items ──
  // "flamenco jazz fusion, jazz fusion, swing" → ["flamenco jazz fusion", "jazz fusion", "swing"]
  const displayTags = (p.display_tags || "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

  // ── BPM: extract from tags or description ──
  const rawTags = meta.tags || prompt || "";
  const desc = meta.gpt_description_prompt || "";
  const bpmMatch = (rawTags + " " + desc).match(/(\d{2,3})\s*bpm/i);
  const bpm = bpmMatch ? parseInt(bpmMatch[1]) : null;

  // ── Moods: short keywords from end of prompt line ──
  const moodMatch = prompt.match(/[.,]\s*([a-z, ]+)$/i);
  const moods = moodMatch
    ? moodMatch[1].split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
    : [];

  // ── Searchable text: compact string for client-side search ──
  // Combine title + artist + tags + moods + description into one searchable blob
  const searchText = [
    title, artist, displayTags.join(" "), moods.join(" "), desc
  ].join(" ").toLowerCase();

  return {
    id,
    t: p.title || title || "Untitled",           // title
    a: p.display_name || artist || "Unknown",     // artist
    y: year || (createdAt ? new Date(createdAt).getFullYear().toString() : ""),
    d: duration,                                   // duration
    bpm,
    inst: isInstrumental,
    tags: displayTags,                             // individual genre tags
    moods,
    desc: desc || null,                            // creative brief (for detail panel)
    img: p.image_url || coverArt || null,
    imgL: p.image_large_url || null,
    url: p.audio_url || (p.media_urls && p.media_urls[1] && p.media_urls[1].url) || "",
    date: createdAt || null,
    s: searchText,                                 // pre-built search string
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
const tagCounts = new Map();

for (const file of files) {
  try {
    const content = fs.readFileSync(path.join(TRACKS_DIR, file), "utf-8");
    const track = parseMetadata(content, file);
    if (track && track.id) {
      tracks.push(track);
      // Count tag frequency for the top-tags index
      track.tags.forEach(tag => tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1));
    } else {
      errors.push({ file, reason: "Could not parse" });
    }
  } catch (e) {
    errors.push({ file, reason: e.message });
  }
}

tracks.sort((a, b) => a.t.localeCompare(b.t));

// ── Top tags: sorted by frequency, top 20 ──
const topTags = [...tagCounts.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)
  .map(([tag]) => tag);

const manifest = {
  n: tracks.length,
  at: new Date().toISOString(),
  topTags,
  tracks,
};

fs.writeFileSync(OUT_FILE, JSON.stringify(manifest));

const sizeKB = (fs.statSync(OUT_FILE).size / 1024).toFixed(1);
console.log(`  ✅ ${tracks.length} tracks → manifest.json (${sizeKB} KB)`);
console.log(`  📊 ${topTags.length} top tags: ${topTags.slice(0, 8).join(", ")}…`);
if (errors.length) {
  console.log(`  ⚠️  ${errors.length} error(s):`);
  errors.forEach(e => console.log(`     - ${e.file}: ${e.reason}`));
}
console.log("");
