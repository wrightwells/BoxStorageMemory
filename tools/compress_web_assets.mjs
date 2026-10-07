// Precompress immutable build assets once, keeping compression off the request path.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
const directory = new URL("../frontend/dist/assets/", import.meta.url);
for (const name of await readdir(directory)) {
  if (!/\.(js|css)$/.test(name)) continue;
  const source = await readFile(new URL(name, directory));
  await writeFile(
    new URL(`${name}.gz`, directory),
    gzipSync(source, { level: 6 }),
  );
}
