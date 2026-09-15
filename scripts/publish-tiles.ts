import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import { copyFile, mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { bytesToHeader } from 'pmtiles';

// Official command reference: https://huggingface.co/docs/huggingface_hub/guides/cli#hf-upload
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: npm run tiles:publish -- OWNER/DATASET [public/tiles/basemap.pmtiles]\nRequires hf CLI, hf auth login (write scope), and an existing PUBLIC dataset owned by you.\nUploads ONLY basemap.pmtiles and its OSM dataset card in one commit. Writes a SHA-pinned VITE_BASEMAP_URL to .env.production; never uploads app/config/geocodes.');
    return;
  }
  const [repository, archiveArg = 'public/tiles/basemap.pmtiles'] = args;
  if (args.length > 2 || !repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Specify an owner-supplied OWNER/DATASET repository ID; use --help.');
  const cli = spawnSync('hf', ['version'], { encoding: 'utf8' });
  if (cli.error || cli.status !== 0) throw new Error('Missing working hf CLI. Install from https://huggingface.co/docs/huggingface_hub/guides/cli and run hf auth login.');
  const auth = spawnSync('hf', ['auth', 'whoami'], { encoding: 'utf8' });
  if (auth.error || auth.status !== 0) throw new Error('An authenticated hf CLI session with dataset write access is required. Run hf auth login; no credentials are printed or written by this script.');
  const archive = resolve(archiveArg);
  const file = await stat(archive);
  if (!file.isFile() || file.size < 127) throw new Error('Archive must be a nonempty PMTiles v3 file.');
  const handle = await open(archive, 'r');
  try {
    const buffer = Buffer.alloc(127); await handle.read(buffer, 0, 127, 0);
    if (buffer.subarray(0, 7).toString() !== 'PMTiles' || buffer[7] !== 3) throw new Error('Archive has invalid PMTiles v3 magic.');
    const header = bytesToHeader(Uint8Array.from(buffer).buffer);
    if (header.tileType !== 1 || header.numAddressedTiles === 0) throw new Error('Expected a nonempty vector basemap archive.');
  } finally { await handle.close(); }
  const metadataResponse = await fetch(`https://huggingface.co/api/datasets/${repository}`, { signal: AbortSignal.timeout(30_000) });
  if (!metadataResponse.ok) throw new Error(`Public dataset lookup returned HTTP ${metadataResponse.status}. Create the intended public dataset first; this script never creates or changes repository visibility.`);
  const metadata = await metadataResponse.json() as { private?: boolean };
  if (metadata.private !== false) throw new Error('Target must be an existing public dataset: a browser basemap cannot depend on private credentials.');
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(archive)) digest.update(chunk as Buffer);
  const hash = digest.digest('hex');
  const staging = await mkdtemp(join(tmpdir(), 'atlas-tiles-publish-'));
  try {
    await copyFile(archive, join(staging, 'basemap.pmtiles'), constants.COPYFILE_FICLONE);
    await writeFile(join(staging, 'README.md'), `---\nlicense: odbl\ntask_categories:\n- other\ntags:\n- geospatial\n- pmtiles\n- openstreetmap\n---\n\n# Atlas basemap\n\nThis dataset contains only a PMTiles basemap archive, not personal places, configuration, geocodes, or application code.\n\n© [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). Cartography and basemap processing: [Protomaps](https://protomaps.com). OpenStreetMap data is available under the [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/). This vector tileset is distributed as a Produced Work; retain OpenStreetMap attribution when displaying it.\n\nArchive SHA-256: \`${hash}\`\nArchive bytes: ${file.size}\n`);
    const commitMessage = `Publish Atlas basemap ${randomUUID()}`;
    // A fresh staging directory is the allowlist: exactly two files, no project traversal.
    const upload = spawnSync('hf', ['upload', repository, staging, '.', '--repo-type', 'dataset', '--commit-message', commitMessage, '--quiet'], { encoding: 'utf8', maxBuffer: 1024 * 1024, env: { ...process.env, HF_HUB_DISABLE_PROGRESS_BARS: '1' } });
    if (upload.error || upload.status !== 0) throw new Error(`hf upload failed (exit ${upload.status ?? 'unavailable'}). Check hf authentication, write permission and connectivity. CLI output was withheld to avoid leaking credentials.`);
    // hf upload prints a branch URL, NOT necessarily an immutable commit URL.
    // Identify this exact upload by its unique commit title, never just the current branch head.
    const commitsResponse = await fetch(`https://huggingface.co/api/datasets/${repository}/commits/main`, { signal: AbortSignal.timeout(30_000) });
    if (!commitsResponse.ok) throw new Error(`Upload completed but commit lookup returned HTTP ${commitsResponse.status}; .env.production was not changed.`);
    const commits = await commitsResponse.json() as { id: string; title: string }[];
    const commit = commits.find(entry => entry.title === commitMessage);
    if (!commit || !/^[0-9a-f]{40}$/.test(commit.id)) throw new Error('Upload completed but its exact commit SHA could not be identified; .env.production was not changed.');
    const treeResponse = await fetch(`https://huggingface.co/api/datasets/${repository}/tree/${commit.id}`, { signal: AbortSignal.timeout(30_000) });
    if (!treeResponse.ok) throw new Error(`Pinned tree lookup returned HTTP ${treeResponse.status}; .env.production was not changed.`);
    const tree = await treeResponse.json() as { path: string; oid: string; size: number; lfs?: { oid: string } }[];
    const remote = tree.find(entry => entry.path === 'basemap.pmtiles');
    if (remote?.size !== file.size) throw new Error('Pinned archive size did not match the uploaded artifact; .env.production was not changed.');
    if (remote.lfs) {
      if (remote.lfs.oid !== hash) throw new Error('Pinned archive SHA-256 did not match the uploaded artifact; .env.production was not changed.');
    } else {
      // Small files may be normal Git blobs rather than LFS objects.
      const blob = createHash('sha1').update(`blob ${file.size}\0`);
      for await (const chunk of createReadStream(archive)) blob.update(chunk as Buffer);
      if (remote.oid !== blob.digest('hex')) throw new Error('Pinned Git blob did not match the uploaded artifact; .env.production was not changed.');
    }
    const url = `https://huggingface.co/datasets/${repository}/resolve/${commit.id}/basemap.pmtiles`;
    let previous = '';
    try { previous = await readFile('.env.production', 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const retained = previous.split(/\r?\n/).filter(line => !/^\s*(?:export\s+)?VITE_BASEMAP_URL\s*=/.test(line));
    while (retained.at(-1) === '') retained.pop();
    await writeFile('.env.production', `${retained.length ? `${retained.join('\n')}\n` : ''}VITE_BASEMAP_URL=${url}\n`, { mode: 0o600 });
    console.log(`Uploaded archive and OSM card at commit ${commit.id}. Updated VITE_BASEMAP_URL in .env.production.\nRun npm run verify:hosting -- ${url} --origin YOUR_DEPLOYMENT_ORIGIN before choosing remote hosting.`);
  } finally { await rm(staging, { recursive: true, force: true }); }
}
main().catch((error: unknown) => { console.error(`Tile publishing: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
