import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdir, rm, cp, writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, 'package.json'));
const OUT = process.argv[2] ? process.argv[2] : join(here, '..', '..', 'vendor');
const NM = join(here, 'node_modules');
const pkgVer = name => JSON.parse(readFileSync(join(NM, name, 'package.json'), 'utf8')).version;

await rm(OUT, {recursive: true, force: true});
await mkdir(OUT, {recursive: true});

const copies = [
  ['leaflet', 'leaflet', ['dist/leaflet.js', 'dist/leaflet.css', 'dist/images']],
  ['leaflet.heat', 'leaflet.heat', ['dist/leaflet-heat.js']],
  ['leaflet.markercluster', 'leaflet.markercluster', ['dist/leaflet.markercluster.js', 'dist/MarkerCluster.css', 'dist/MarkerCluster.Default.css']],
  ['@geoman-io/leaflet-geoman-free', 'leaflet-geoman-free', ['dist/leaflet-geoman.min.js', 'dist/leaflet-geoman.css']],
];
for (const [pkg, dir, files] of copies) {
  const dest = join(OUT, `${dir}-${pkgVer(pkg)}`);
  await mkdir(dest, {recursive: true});
  for (const f of files) await cp(join(NM, pkg, f), join(dest, f.replace(/^dist\//, '')), {recursive: true});
}

const ESM = join(OUT, 'esm');
await mkdir(ESM, {recursive: true});
const common = {bundle: true, format: 'esm', minify: true, target: 'es2020', platform: 'browser', legalComments: 'inline',
  define: {'process.env.NODE_ENV': '"production"'}, logLevel: 'warning'};
const entry = async (name, contents) => build({...common, stdin: {contents, resolveDir: here, sourcefile: name + '.entry.js'}, outfile: join(ESM, name + '.js')});

await entry('react-all', `import React from 'react'; import ReactDOM from 'react-dom'; import ReactDOMClient from 'react-dom/client'; export {React, ReactDOM, ReactDOMClient};`);
const ident = k => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) && k !== 'default';
const stub = (local, mod) => {
  const keys = Object.keys(require(mod)).filter(ident).sort();
  return `import {${local}} from "./react-all.js";\nexport default ${local};\nexport const {${keys.join(', ')}} = ${local};\n`;
};
await writeFile(join(ESM, 'react.js'), stub('React', 'react'));
await writeFile(join(ESM, 'react-dom.js'), stub('ReactDOM', 'react-dom'));
await writeFile(join(ESM, 'react-dom-client.js'), stub('ReactDOMClient', 'react-dom/client'));

await entry('htm', `export {default} from 'htm';`);
await entry('three', `export * from 'three';`);
await entry('protomaps-leaflet', `export * from 'protomaps-leaflet';`);
await entry('protomaps-basemaps', `export * from '@protomaps/basemaps';`);
await entry('polygon-clipping', `export {default} from 'polygon-clipping';`);

const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;500;600;700&display=swap';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const FONTS = join(OUT, 'fonts');
await mkdir(FONTS, {recursive: true});
let css = await (await fetch(FONT_CSS, {headers: {'User-Agent': UA}})).text();
const urls = [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(m => m[1]))];
if (!urls.length) throw new Error('no font files found in Google Fonts CSS');
for (const u of urls) {
  const buf = Buffer.from(await (await fetch(u)).arrayBuffer());
  const name = 'noto-sans-thai-' + createHash('sha256').update(u).digest('hex').slice(0, 12) + '.woff2';
  await writeFile(join(FONTS, name), buf);
  css = css.split(u).join(name);
}
await writeFile(join(FONTS, 'noto-sans-thai.css'), css);
const OFL_URL = 'https://raw.githubusercontent.com/notofonts/thai/main/OFL.txt';
const ofl = await fetch(OFL_URL);
if (!ofl.ok) throw new Error('could not download the font licence: ' + ofl.status);
await writeFile(join(FONTS, 'OFL.txt'), Buffer.from(await ofl.arrayBuffer()));

const versions = Object.fromEntries(['react', 'react-dom', 'htm', 'three', 'protomaps-leaflet', '@protomaps/basemaps', 'polygon-clipping',
  'leaflet', 'leaflet.heat', 'leaflet.markercluster', '@geoman-io/leaflet-geoman-free'].map(p => [p, pkgVer(p)]));
await writeFile(join(OUT, 'VERSIONS.json'), JSON.stringify({builtFrom: 'tools/vendor', versions, fonts: FONT_CSS, fontFiles: urls.length}, null, 2) + '\n');
console.log('vendor built at', OUT, JSON.stringify(versions));
