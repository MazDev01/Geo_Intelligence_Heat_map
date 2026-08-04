// Syntax check every source file the way the BROWSER parses it: as an ES module.
//
// Why not `node --check`? It parses .js in "script goal". These files start with `import`, so it fails
// immediately on line 1 with "Cannot use import statement outside a module" and never reaches the real
// error deeper in the file — and then reports success anyway. Verified: it PASSES files containing a
// stray backtick inside an html`...` comment, and files with a nested ${} inside a style=${{...}}
// expression. Both blank the page in a browser.
//
// vm.SourceTextModule COMPILES in module goal but does not execute or resolve imports, so it needs no
// node_modules, no DOM shim, and has no side effects (app.js won't try to mount the app).
//
// Usage: node --experimental-vm-modules checkall.mjs [dir=src]
import vm from "node:vm";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

async function jsFiles(dir){
  const out = [];
  for(const e of await readdir(dir, {withFileTypes:true})){
    const full = path.join(dir, e.name);
    if(e.isDirectory()){ if(e.name!=="node_modules") out.push(...await jsFiles(full)); }
    else if(e.name.endsWith(".js") || e.name.endsWith(".mjs")) out.push(full);
  }
  return out;
}

const roots = process.argv.slice(2);
const targets = roots.length ? roots : ["src", "gen.mjs", "server.mjs"];
const files = [];
for(const t of targets){
  try{ files.push(...await jsFiles(t)); }
  catch{ files.push(t); }   // a plain file path
}

let failed = 0;
for(const f of files.sort()){
  const src = await readFile(f, "utf8");
  try{
    new vm.SourceTextModule(src, {identifier:f});
    console.log(`[OK]   ${f}`);
  }catch(e){
    failed++;
    const line = e.stack && (e.stack.match(/:(\d+)\n/)||[])[1];
    console.log(`[FAIL] ${f}${line?`:${line}`:""} — ${e.message}`);
  }
}
console.log(failed ? `\n${failed} file(s) FAILED` : `\nall ${files.length} file(s) parse as ES modules`);
process.exit(failed ? 1 : 0);
