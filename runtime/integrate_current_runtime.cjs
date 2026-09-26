#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readArchive, replaceEntries } = require("./patch_current_runtime.cjs");

const ASSETS = "webview/assets/";
const PET_ID = "custom:xiaohuangtuan";

function replaceOnce(text, before, after, label) {
  const first = text.indexOf(before);
  if (first < 0 || first !== text.lastIndexOf(before)) throw new Error(`Unsupported client: ${label} did not match once`);
  return text.slice(0, first) + after + text.slice(first + before.length);
}

function findModule(archive, expression) {
  const matches = archive.entries.filter(item => expression.test(item.path));
  if (matches.length !== 1) throw new Error(`Expected one client module for ${expression}, found ${matches.length}`);
  return matches[0].path;
}

function buildReplacements(archive, { motionSource, profileSource }) {
  const rendererPath = findModule(archive, /^webview\/assets\/app-initial-[\w-]+\.js$/);
  const mascotPath = findModule(archive, /^webview\/assets\/avatar-mascot-button-[\w-]+\.js$/);
  let renderer = archive.readEntry(rendererPath).toString("utf8");
  let mascot = archive.readEntry(mascotPath).toString("utf8");
  renderer = replaceOnce(renderer,
    "return(0,Fcc.useEffect)(()=>{let e=c.current;if(e==null)return;if(n!=null){e.style.backgroundPosition=Tcc(n,d);return}",
    `return(0,Fcc.useEffect)(()=>{if(i.petId!==\`${PET_ID}\`||c.current==null)return;let e=installNaiwa(c.current,{state:u,lookFrame:n,reducedMotion:l,rows:d});return()=>e.dispose()},[i.petId,l,d]),(0,Fcc.useEffect)(()=>{let e=c.current;if(e==null)return;if(e.dataset.codexPetId===\`${PET_ID}\`){updateNaiwa(e,{state:u,lookFrame:n,reducedMotion:l,rows:d});return}if(n!=null){e.style.backgroundPosition=Tcc(n,d);return}`,
    "Naiwa renderer lifecycle");
  renderer = replaceOnce(renderer,
    "},[u,n,l,d]),(0,Icc.jsx)(`div`,{ref:c,className:Q(Ncc.Root,t)",
    "},[u,n,l,d,i.petId]),(0,Icc.jsx)(`div`,{ref:c,className:Q(Ncc.Root,t)",
    "renderer pet dependency");
  renderer = replaceOnce(renderer,
    "onPointerEnter:()=>{r&&s(!0)},onPointerLeave:()=>{r&&s(!1)}",
    `onPointerEnter:()=>{i.petId!==\`${PET_ID}\`&&r&&s(!0)},onPointerLeave:()=>{i.petId!==\`${PET_ID}\`&&r&&s(!1)}`,
    "renderer default hover gate");
  renderer = `import {installNaiwa,updateNaiwa} from "./naiwa-motion.mjs";\n${renderer}`;
  const selector = JSON.stringify(`[data-codex-pet-id="${PET_ID}"]`);
  mascot = replaceOnce(mascot,
    "v=()=>{d(!0)},y=()=>{d(!1)}",
    `v=e=>{e.currentTarget.querySelector(${selector})||d(!0)},y=e=>{e.currentTarget.querySelector(${selector})||d(!1)}`,
    "mascot default hover gate");
  const stripSourceMap = text => text.replace(/\n\/\/# sourceMappingURL=[^\r\n]+\s*$/, "\n");
  return new Map([
    [rendererPath, stripSourceMap(renderer)],
    [mascotPath, stripSourceMap(mascot)],
    [`${ASSETS}naiwa-motion.mjs`, motionSource],
    [`${ASSETS}motion-profile.mjs`, profileSource],
  ]);
}

function integrate(source, output, options = {}) {
  const motionPath = options.motionPath || path.join(__dirname, "naiwa-motion.mjs");
  const profilePath = options.profilePath || path.join(__dirname, "motion-profile.mjs");
  const archive = readArchive(source);
  const replacements = buildReplacements(archive, {
    motionSource: fs.readFileSync(motionPath),
    profileSource: fs.readFileSync(profilePath),
  });
  return replaceEntries(source, replacements, output);
}

module.exports = { buildReplacements, integrate, replaceOnce };

if (require.main === module) {
  const args = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index], value = process.argv[index + 1];
    if (!value || !["--source", "--output", "--motion", "--profile"].includes(key)) {
      throw new Error("Usage: --source app.asar --output patched.asar [--motion naiwa-motion.mjs] [--profile motion-profile.mjs]");
    }
    args[key.slice(2)] = value;
  }
  if (!args.source || !args.output) throw new Error("A source ASAR and separate output ASAR are required");
  const report = integrate(args.source, args.output, { motionPath: args.motion, profilePath: args.profile });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
