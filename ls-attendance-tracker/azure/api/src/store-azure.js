// Azure Table Storage (records) + Blob Storage (photos) behind the LSAPI store interface.
// Each record is one entity: PartitionKey = table-specific, RowKey = id, j = JSON, plus a few
// top-level columns (wid, code, workDate, serverTs, clientId, enabled) so hints become server-side filters.
const { TableClient, odata } = require('@azure/data-tables');
const { BlobServiceClient } = require('@azure/storage-blob');

function azureStore(conn, prefix = 'ls') {
  const tables = {}, ready = {};
  const local = /DefaultEndpointsProtocol=http;|UseDevelopmentStorage=true/i.test(conn);        // Azurite (local emulator) is plain http
  const tc = t => (tables[t] ||= TableClient.fromConnectionString(conn, prefix + t, local ? { allowInsecureConnection: true } : {}));
  const ensure = async t => (ready[t] ||= tc(t).createTable().catch(e => { if (e.statusCode !== 409) throw e; }));
  const blob = BlobServiceClient.fromConnectionString(conn).getContainerClient(prefix + '-photos');
  let blobReady = null;
  const pk = (t, o) => t === 'punches' ? String(o.workDate || '0000-00').slice(0, 7) : t;   // punches partitioned by month
  const cols = o => { const c = {}; for (const k of ['wid', 'code', 'workDate', 'serverTs', 'clientId', 'enabled', 'status']) if (o[k] !== undefined) c[k] = o[k]; return c; };
  const parse = e => JSON.parse(e.j);
  function filter(t, h = {}) {
    const f = [];
    if (h.wid) f.push(odata`wid eq ${h.wid}`);
    if (h.code) f.push(odata`code eq ${h.code}`);
    if (h.clientId) f.push(odata`clientId eq ${h.clientId}`);
    if (h.workDate) f.push(odata`workDate eq ${h.workDate}`);
    if (h.fromDate) f.push(odata`workDate ge ${h.fromDate}`);
    if (h.since) f.push(odata`serverTs gt ${h.since}`);
    if (h.enabled) f.push('enabled eq true');
    return f.length ? f.join(' and ') : undefined;
  }
  return {
    async get(t, id) {
      await ensure(t);
      const q = tc(t).listEntities({ queryOptions: { filter: odata`RowKey eq ${String(id)}` } });
      for await (const e of q) return parse(e);
      return null;
    },
    async put(t, o) {
      await ensure(t);
      const old = t === 'punches' ? await this.get(t, o.id) : null;           // a re-dated punch moves partition
      if (old && pk(t, old) !== pk(t, o)) await tc(t).deleteEntity(pk(t, old), String(o.id)).catch(() => {});
      await tc(t).upsertEntity({ partitionKey: pk(t, o), rowKey: String(o.id), j: JSON.stringify(o), ...cols(o) }, 'Replace');
    },
    async del(t, id) { const o = await this.get(t, id); if (o) await tc(t).deleteEntity(pk(t, o), String(id)).catch(() => {}); },
    async list(t, fn, hint) {
      await ensure(t);
      const out = [];
      for await (const e of tc(t).listEntities({ queryOptions: { filter: filter(t, hint) } })) { const o = parse(e); if (!fn || fn(o)) out.push(o); }
      return out;
    },
    async putBlob(name, bytes, type) {
      blobReady ||= blob.createIfNotExists();                                  // private container (no public access)
      await blobReady;
      await blob.getBlockBlobClient(name).uploadData(Buffer.from(bytes), { blobHTTPHeaders: { blobContentType: type || 'image/jpeg' } });
    },
    async getBlob(name) {
      try { const b = blob.getBlobClient(name); const buf = await b.downloadToBuffer(); const p = await b.getProperties(); return { bytes: new Uint8Array(buf), type: p.contentType }; }
      catch (e) { if (e.statusCode === 404) return null; throw e; }
    }
  };
}
module.exports = { azureStore };
