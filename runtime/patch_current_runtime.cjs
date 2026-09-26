#!/usr/bin/env node
"use strict";

// Small ASAR reader/repacker. It edits a separate application copy; vendor source
// and binaries are deliberately not part of this repository.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function listEntries(header, prefix = "") {
  const entries = [];
  for (const [name, entry] of Object.entries(header.files || {})) {
    const entryPath = prefix ? `${prefix}/${name}` : name;
    if (entry.files) entries.push(...listEntries(entry, entryPath));
    else entries.push({ path: entryPath, entry });
  }
  return entries;
}

function readExactly(fd, buffer, position) {
  let done = 0;
  while (done < buffer.length) {
    const count = fs.readSync(fd, buffer, done, buffer.length - done, position + done);
    if (!count) throw new Error("Unexpected end of ASAR archive");
    done += count;
  }
  return buffer;
}

function readArchive(archivePath) {
  const absolutePath = path.resolve(archivePath);
  const fd = fs.openSync(absolutePath, "r");
  try {
    const prefix = readExactly(fd, Buffer.alloc(16), 0);
    const headerSize = prefix.readUInt32LE(4);
    const jsonSize = prefix.readUInt32LE(12);
    if (prefix.readUInt32LE(0) !== 4 || jsonSize + 8 > headerSize) {
      throw new Error("Invalid ASAR header");
    }
    const header = JSON.parse(readExactly(fd, Buffer.alloc(jsonSize), 16).toString("utf8"));
    const archive = { path: absolutePath, header, contentOffset: 8 + headerSize };
    archive.entries = listEntries(header);
    archive.readEntry = entryPath => readEntry(archive, entryPath);
    return archive;
  } finally {
    fs.closeSync(fd);
  }
}

function getEntry(header, entryPath, create = false) {
  const parts = entryPath.split("/");
  if (parts.some(part => !part || part === "." || part === ".." || part.includes("\\"))) {
    throw new Error(`Invalid ASAR entry path: ${entryPath}`);
  }
  let parent = header;
  for (const part of parts.slice(0, -1)) {
    if (create) {
      parent.files ||= {};
      parent.files[part] ||= { files: {} };
    }
    parent = parent.files?.[part];
    if (!parent?.files) throw new Error(`Missing ASAR directory in ${entryPath}`);
  }
  parent.files ||= {};
  const name = parts[parts.length - 1];
  if (create) parent.files[name] ||= { size: 0, offset: "0" };
  const entry = parent.files[name];
  if (!entry) throw new Error(`Missing ASAR entry: ${entryPath}`);
  return entry;
}

function readEntry(archive, entryPath) {
  const entry = getEntry(archive.header, entryPath);
  if (entry.files || entry.unpacked || entry.link) {
    throw new Error(`Expected a packed regular entry: ${entryPath}`);
  }
  const fd = fs.openSync(archive.path, "r");
  try {
    return readExactly(fd, Buffer.alloc(entry.size), archive.contentOffset + Number(entry.offset));
  } finally {
    fs.closeSync(fd);
  }
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function integrityFor(buffer, blockSize = 4 * 1024 * 1024) {
  const blocks = [];
  for (let offset = 0; offset < buffer.length; offset += blockSize) {
    blocks.push(sha256(buffer.subarray(offset, offset + blockSize)));
  }
  return { algorithm: "SHA256", hash: sha256(buffer), blockSize, blocks };
}

function encodeHeader(header) {
  const json = Buffer.from(JSON.stringify(header), "utf8");
  const paddedLength = Math.ceil(json.length / 4) * 4;
  const buffer = Buffer.alloc(16 + paddedLength);
  buffer.writeUInt32LE(4, 0);
  buffer.writeUInt32LE(8 + paddedLength, 4);
  buffer.writeUInt32LE(4 + paddedLength, 8);
  buffer.writeUInt32LE(json.length, 12);
  json.copy(buffer, 16);
  return buffer;
}

function copyRange(sourceFd, outputFd, position, length) {
  const scratch = Buffer.alloc(Math.min(length, 1024 * 1024));
  let done = 0;
  while (done < length) {
    const count = Math.min(scratch.length, length - done);
    readExactly(sourceFd, scratch.subarray(0, count), position + done);
    fs.writeSync(outputFd, scratch, 0, count);
    done += count;
  }
}

function replaceEntries(sourcePath, replacements, outputPath) {
  const archive = readArchive(sourcePath);
  const output = path.resolve(outputPath);
  if (archive.path.toLowerCase() === output.toLowerCase()) {
    throw new Error("Write the patched ASAR to a separate application copy");
  }
  const changes = new Map(Object.entries(replacements instanceof Map ? Object.fromEntries(replacements) : replacements)
    .map(([name, data]) => [name, Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8")]));
  const header = structuredClone(archive.header);
  const oldEntries = new Map(archive.entries.map(item => [item.path, item.entry]));
  for (const [name, data] of changes) {
    const entry = getEntry(header, name, true);
    if (entry.files || entry.unpacked || entry.link) throw new Error(`Cannot replace non-packed entry: ${name}`);
    entry.size = data.length;
    entry.integrity = integrityFor(data, entry.integrity?.blockSize || 4 * 1024 * 1024);
  }
  const packed = listEntries(header).filter(({ entry }) => !entry.unpacked && !entry.link);
  // Preserve physical entry order so unrelated data and locality stay familiar.
  packed.sort((left, right) => {
    const a = oldEntries.get(left.path), b = oldEntries.get(right.path);
    return (a ? Number(a.offset) : Infinity) - (b ? Number(b.offset) : Infinity);
  });
  let offset = 0;
  for (const { entry } of packed) {
    entry.offset = String(offset);
    offset += entry.size;
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const sourceFd = fs.openSync(archive.path, "r");
  let outputFd;
  try {
    outputFd = fs.openSync(output, "w");
    fs.writeSync(outputFd, encodeHeader(header));
    for (const { path: name } of packed) {
      const data = changes.get(name);
      if (data) fs.writeSync(outputFd, data);
      else {
        const old = oldEntries.get(name);
        copyRange(sourceFd, outputFd, archive.contentOffset + Number(old.offset), old.size);
      }
    }
  } finally {
    if (outputFd !== undefined) fs.closeSync(outputFd);
    fs.closeSync(sourceFd);
  }
  const patched = readArchive(output);
  const changedEntries = [];
  for (const [name, data] of changes) {
    const actual = patched.readEntry(name);
    if (!actual.equals(data)) throw new Error(`Patched entry verification failed: ${name}`);
    changedEntries.push({ path: name, bytes: data.length, sha256: sha256(data), added: !oldEntries.has(name) });
  }
  return { source: archive.path, output, bytes: fs.statSync(output).size, changedEntries };
}

module.exports = { readArchive, listEntries, readEntry, replaceEntries, encodeHeader, integrityFor };

if (require.main === module) {
  const args = process.argv.slice(2), entries = {};
  let source, output;
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!value) throw new Error("Usage: --source app.asar --output patched.asar --entry path=file [--entry path=file]");
    if (key === "--source") source = value;
    else if (key === "--output") output = value;
    else if (key === "--entry") {
      const split = value.indexOf("=");
      if (split < 1) throw new Error("Use --entry packed/path=local-file");
      entries[value.slice(0, split)] = fs.readFileSync(value.slice(split + 1));
    } else throw new Error(`Unknown option: ${key}`);
  }
  if (!source || !output || !Object.keys(entries).length) throw new Error("Source, output and at least one entry are required");
  process.stdout.write(`${JSON.stringify(replaceEntries(source, entries, output), null, 2)}\n`);
}
