// Static-only build — frontend reads data/snapshot.json from GitHub raw.
// No server is bundled or run in production.
import { build as viteBuild } from "vite";
import { rm } from "fs/promises";

async function buildAll() {
  await rm("dist", { recursive: true, force: true });
  console.log("building client...");
  await viteBuild();
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
