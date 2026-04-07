const fs = require("fs/promises");
const path = require("path");

const ROOT = process.cwd();
const SITE_ROOT = path.join(ROOT, "output", "site");
const PDF_ROOT = path.join(ROOT, "output", "pdf");
const DIST_ROOT = path.join(ROOT, "dist");

async function rmSafe(target) {
  await fs.rm(target, { recursive: true, force: true });
}

async function ensureDir(target) {
  await fs.mkdir(target, { recursive: true });
}

async function copyDir(source, target) {
  await ensureDir(target);
  await fs.cp(source, target, { recursive: true });
}

async function rewriteRootIndex() {
  const indexPath = path.join(DIST_ROOT, "index.html");
  let html = await fs.readFile(indexPath, "utf8");

  html = html.replace(/href="\/dark-tower-int\//g, 'href="dark-tower-int/');
  html = html.replace(/href="\/pdf\//g, 'href="pdf/');

  await fs.writeFile(indexPath, html, "utf8");
}

async function writeNoJekyll() {
  await fs.writeFile(path.join(DIST_ROOT, ".nojekyll"), "", "utf8");
}

async function main() {
  await rmSafe(DIST_ROOT);

  await copyDir(SITE_ROOT, DIST_ROOT);
  await copyDir(PDF_ROOT, path.join(DIST_ROOT, "pdf"));
  await rewriteRootIndex();
  await writeNoJekyll();

  console.log(`GitHub Pages bundle ready at ${DIST_ROOT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
