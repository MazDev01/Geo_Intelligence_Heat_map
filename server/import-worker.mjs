import {parentPort, workerData} from 'node:worker_threads';
import {parseUpload} from './import-parse.mjs';

try {
  const {bytes, filename} = workerData;
  const table = parseUpload(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), filename);
  parentPort.postMessage({ok: true, table});
} catch (e) {
  if (e && (e.status === 400 || e.status === 413)) parentPort.postMessage({ok: false, status: e.status, message: e.message});
  else throw e;
}
