#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const TARGET_ENTRY = "webview/assets/codex-avatar-BE-RjeI-.js";
const HOVER_ENTRY = "webview/assets/avatar-mascot-button-C6QI44bt.js";

const ORIGINAL_FUNCTION =
  "function A(e,t){let n=z[e];if(t)return{frames:[n[0]],loopStartIndex:null};if(e===`idle`)return{frames:R,loopStartIndex:0};let r=[...n,...n,...n];return{frames:[...r,...R],loopStartIndex:r.length}}";

const LOOPING_FUNCTION =
  "function A(e,t){let n=z[e];return{frames:t?[n[0]]:e===`idle`?R:n[0].rowIndex>4?n:[...n,...n,...n,...R],loopStartIndex:t?null:e===`idle`||n[0].rowIndex>4?0:n.length*3}}";

const TIMING_REPLACEMENTS = [
  ["failed:j(5,8,140,240)", "failed:j(5,8,224,384)"],
  ["review:j(8,6,150,280)", "review:j(8,6,360,600)"],
  ["running:j(7,6,120,220)", "running:j(7,6,288,480)"],
  ["waiting:j(6,6,150,260)", "waiting:j(6,6,336,560)"],
  ["waving:j(3,4,140,280)", "waving:j(3,4,180,360)"],
];

const RUNTIME_TIMINGS = {
  idle: [1680, 660, 660, 840, 840, 1920],
  "running-right": [120, 120, 120, 120, 120, 120, 120, 220],
  "running-left": [120, 120, 120, 120, 120, 120, 120, 220],
  waving: [180, 180, 180, 360],
  jumping: [140, 140, 140, 140, 280],
  failed: [224, 224, 224, 224, 224, 224, 224, 384],
  waiting: [336, 336, 336, 336, 336, 560],
  running: [288, 288, 288, 288, 288, 480],
  review: [360, 360, 360, 360, 360, 600],
};

const ORIGINAL_HOVER_STATE =
  "[ee,S]=(0,b.useState)(!1),C=m??(ee?`jumping`:_),w=o!=null,T=w||l!=null,E;n!=null&&";

const LATCHED_HOVER_STATE =
  "[ee,S]=(0,b.useState)(!1),C=m??(ee||_),w=o!=null,T=w||l!=null,E;(0,b.useEffect)(()=>{S(!1)},[_]);n!=null&&";

const ORIGINAL_HOVER_HANDLERS = "k=()=>{S(!0)},A=()=>{S(!1)}";
const LATCHED_HOVER_HANDLERS = "k=()=>{S(`jumping`)},A=()=>{S(e=>e?`idle`:!1)}";

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value == null) {
      throw new Error("Usage: patch_codex_pet_runtime.js --source <app.asar> --output <patched.asar> --report <report.json> --entry-output <patched.js>");
    }
    args[key.slice(2)] = value;
  }
  for (const required of ["source", "output", "report", "entry-output"]) {
    if (!args[required]) throw new Error(`Missing --${required}`);
  }
  return args;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function readArchive(archivePath) {
  const fd = fs.openSync(archivePath, "r");
  try {
    const prefix = Buffer.alloc(16);
    fs.readSync(fd, prefix, 0, prefix.length, 0);
    const headerPickleSize = prefix.readUInt32LE(4);
    const jsonSize = prefix.readUInt32LE(12);
    const jsonBuffer = Buffer.alloc(jsonSize);
    fs.readSync(fd, jsonBuffer, 0, jsonSize, 16);
    const header = JSON.parse(jsonBuffer.toString("utf8"));
    const contentOffset = 8 + headerPickleSize;
    return { prefix, headerPickleSize, jsonSize, jsonBuffer, header, contentOffset };
  } finally {
    fs.closeSync(fd);
  }
}

function resolveEntry(header, archivePath) {
  let entry = header;
  for (const part of archivePath.split("/")) {
    entry = entry.files?.[part];
    if (!entry) throw new Error(`Missing ASAR entry: ${archivePath}`);
  }
  return entry;
}

function readEntry(archivePath, archive, entry) {
  const fd = fs.openSync(archivePath, "r");
  try {
    const size = Number(entry.size);
    const offset = archive.contentOffset + Number(entry.offset || 0);
    const buffer = Buffer.alloc(size);
    fs.readSync(fd, buffer, 0, size, offset);
    return { buffer, offset };
  } finally {
    fs.closeSync(fd);
  }
}

function replaceExactlyOnce(text, before, after, label) {
  if (Buffer.byteLength(before) !== Buffer.byteLength(after)) {
    throw new Error(`${label} replacement changes byte length`);
  }
  return replaceOnce(text, before, after, label);
}

function replaceOnce(text, before, after, label) {
  const first = text.indexOf(before);
  const last = text.lastIndexOf(before);
  if (first < 0 || first !== last) {
    throw new Error(`${label} expected exactly once`);
  }
  return text.slice(0, first) + after + text.slice(first + before.length);
}

function countByteDiffs(left, right) {
  if (left.length !== right.length) throw new Error("Cannot diff buffers with different lengths");
  let count = 0;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) count += 1;
  }
  return count;
}

function replaceHashOccurrences(headerBuffer, oldHash, newHash) {
  const before = Buffer.from(oldHash, "ascii");
  const after = Buffer.from(newHash, "ascii");
  let cursor = 0;
  let count = 0;
  while (cursor <= headerBuffer.length - before.length) {
    const index = headerBuffer.indexOf(before, cursor);
    if (index < 0) break;
    after.copy(headerBuffer, index);
    count += 1;
    cursor = index + before.length;
  }
  if (count !== 2) {
    throw new Error(`Expected target integrity hash twice in ASAR header, found ${count}`);
  }
  return count;
}

function main() {
  const args = parseArgs(process.argv);
  const source = path.resolve(args.source);
  const output = path.resolve(args.output);
  const reportPath = path.resolve(args.report);
  const entryOutput = path.resolve(args["entry-output"]);

  if (source === output) throw new Error("Patch output must differ from source");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.mkdirSync(path.dirname(entryOutput), { recursive: true });

  const sourceArchive = readArchive(source);
  const sourceEntry = resolveEntry(sourceArchive.header, TARGET_ENTRY);
  const sourceHoverEntry = resolveEntry(sourceArchive.header, HOVER_ENTRY);
  if (sourceEntry.unpacked || sourceEntry.files) throw new Error("Target entry is not a packed file");
  if (sourceHoverEntry.unpacked || sourceHoverEntry.files) throw new Error("Hover entry is not a packed file");
  if (sourceEntry.integrity?.algorithm !== "SHA256") throw new Error("Target entry lacks SHA256 integrity metadata");
  if (sourceHoverEntry.integrity?.algorithm !== "SHA256") throw new Error("Hover entry lacks SHA256 integrity metadata");

  const { buffer: originalBuffer, offset: entryOffset } = readEntry(source, sourceArchive, sourceEntry);
  const { buffer: originalHoverBuffer, offset: hoverEntryOffset } = readEntry(source, sourceArchive, sourceHoverEntry);
  const originalHash = sha256(originalBuffer);
  const originalHoverHash = sha256(originalHoverBuffer);
  if (originalHash !== sourceEntry.integrity.hash || sourceEntry.integrity.blocks?.[0] !== originalHash) {
    throw new Error("Target entry does not match ASAR integrity metadata");
  }
  if (originalHoverHash !== sourceHoverEntry.integrity.hash || sourceHoverEntry.integrity.blocks?.[0] !== originalHoverHash) {
    throw new Error("Hover entry does not match ASAR integrity metadata");
  }

  let text = originalBuffer.toString("utf8");
  const paddedFunction = LOOPING_FUNCTION.padEnd(Buffer.byteLength(ORIGINAL_FUNCTION), " ");
  text = replaceExactlyOnce(text, ORIGINAL_FUNCTION, paddedFunction, "loop function");
  for (const [before, after] of TIMING_REPLACEMENTS) {
    text = replaceExactlyOnce(text, before, after, before);
  }

  const patchedBuffer = Buffer.from(text, "utf8");
  if (patchedBuffer.length !== originalBuffer.length) throw new Error("Patched entry size changed");
  const patchedHash = sha256(patchedBuffer);

  let hoverText = originalHoverBuffer.toString("utf8");
  hoverText = replaceOnce(hoverText, ORIGINAL_HOVER_STATE, LATCHED_HOVER_STATE, "hover state latch");
  hoverText = replaceOnce(hoverText, ORIGINAL_HOVER_HANDLERS, LATCHED_HOVER_HANDLERS, "hover handlers");
  const sourceMapComment = /\n\/\/# sourceMappingURL=avatar-mascot-button-[^\r\n]+\.js\.map\s*$/;
  if (!sourceMapComment.test(hoverText)) throw new Error("Hover entry source map comment was not found");
  hoverText = hoverText.replace(sourceMapComment, "\n//#");
  if (Buffer.byteLength(hoverText) > originalHoverBuffer.length) {
    throw new Error("Hover patch exceeds the fixed ASAR entry size");
  }
  hoverText = hoverText.padEnd(originalHoverBuffer.length, " ");
  const patchedHoverBuffer = Buffer.from(hoverText, "utf8");
  if (patchedHoverBuffer.length !== originalHoverBuffer.length) throw new Error("Patched hover entry size changed");
  const patchedHoverHash = sha256(patchedHoverBuffer);

  const patchedHeader = Buffer.from(sourceArchive.jsonBuffer);
  const headerHashReplacements = replaceHashOccurrences(patchedHeader, originalHash, patchedHash);
  const hoverHeaderHashReplacements = replaceHashOccurrences(patchedHeader, originalHoverHash, patchedHoverHash);

  fs.copyFileSync(source, output);
  const outputFd = fs.openSync(output, "r+");
  try {
    fs.writeSync(outputFd, patchedHeader, 0, patchedHeader.length, 16);
    fs.writeSync(outputFd, patchedBuffer, 0, patchedBuffer.length, entryOffset);
    fs.writeSync(outputFd, patchedHoverBuffer, 0, patchedHoverBuffer.length, hoverEntryOffset);
    fs.fsyncSync(outputFd);
  } finally {
    fs.closeSync(outputFd);
  }
  fs.writeFileSync(entryOutput, patchedBuffer);

  const outputArchive = readArchive(output);
  const outputEntry = resolveEntry(outputArchive.header, TARGET_ENTRY);
  const outputHoverEntry = resolveEntry(outputArchive.header, HOVER_ENTRY);
  const { buffer: verifiedBuffer } = readEntry(output, outputArchive, outputEntry);
  const { buffer: verifiedHoverBuffer } = readEntry(output, outputArchive, outputHoverEntry);
  if (sha256(verifiedBuffer) !== patchedHash) throw new Error("Patched entry verification failed");
  if (sha256(verifiedHoverBuffer) !== patchedHoverHash) throw new Error("Patched hover entry verification failed");
  if (outputEntry.integrity.hash !== patchedHash || outputEntry.integrity.blocks?.[0] !== patchedHash) {
    throw new Error("Patched ASAR integrity metadata verification failed");
  }
  if (outputHoverEntry.integrity.hash !== patchedHoverHash || outputHoverEntry.integrity.blocks?.[0] !== patchedHoverHash) {
    throw new Error("Patched hover ASAR integrity metadata verification failed");
  }
  if (fs.statSync(source).size !== fs.statSync(output).size) throw new Error("Patched ASAR size changed");

  const report = {
    ok: true,
    targetEntry: TARGET_ENTRY,
    source,
    output,
    sourceAsarSha256: sha256(fs.readFileSync(source)),
    patchedAsarSha256: sha256(fs.readFileSync(output)),
    sourceAsarSize: fs.statSync(source).size,
    patchedAsarSize: fs.statSync(output).size,
    entryOffset,
    entrySize: originalBuffer.length,
    originalEntrySha256: originalHash,
    patchedEntrySha256: patchedHash,
    headerHashReplacements,
    changedEntryBytes: countByteDiffs(originalBuffer, patchedBuffer),
    hoverEntry: HOVER_ENTRY,
    hoverEntryOffset,
    hoverEntrySize: originalHoverBuffer.length,
    originalHoverEntrySha256: originalHoverHash,
    patchedHoverEntrySha256: patchedHoverHash,
    hoverHeaderHashReplacements,
    changedHoverEntryBytes: countByteDiffs(originalHoverBuffer, patchedHoverBuffer),
    hoverResetsToIdleUntilExternalStateChanges: true,
    persistentRows: ["failed", "waiting", "running", "review"],
    finiteRows: ["running-right", "running-left", "waving", "jumping"],
    runtimeTimingsMs: RUNTIME_TIMINGS,
    loopDurationsMs: Object.fromEntries(
      Object.entries(RUNTIME_TIMINGS).map(([state, durations]) => [
        state,
        durations.reduce((sum, duration) => sum + duration, 0),
      ]),
    ),
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main();
