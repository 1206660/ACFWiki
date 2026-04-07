# SlimWiki Local Mirror

This project mirrors a SlimWiki space into local static HTML and PDF files, then serves the mirrored pages with a small Express app.

Target wiki:

```text
https://slimwiki.com/dark-tower-int/acfu/welcome
```

Features:

- Preserves page hierarchy and internal links
- Saves each page as rendered HTML
- Saves each page as PDF
- Downloads CSS, fonts, images, and linked assets needed by mirrored pages
- Serves the mirrored wiki locally or on a public server

## Requirements

- Node.js 20+
- npm
- Linux server or VM recommended

## Install

```bash
git clone git@github.com:1206660/ACFWiki.git
cd ACFWiki
npm install
npx playwright install chromium
```

## Mirror The Wiki

Run a full crawl from the configured SlimWiki entry page:

```bash
npm run mirror
```

This writes output to:

- `output/site`: mirrored HTML and downloaded assets
- `output/pdf`: per-page PDFs

## Run The Local Wiki

Start the server:

```bash
npm run serve
```

Default bind:

- Host: `0.0.0.0`
- Port: `80`

Default homepage:

```text
http://YOUR_SERVER_IP/dark-tower-int/acfu/welcome/
```

## One Command Bootstrap

To mirror first and then start the server:

```bash
npm run bootstrap
```

Or:

```bash
./start-local.sh
```

## GitHub Pages Static Publish

This repo can also be published as a pure static site on GitHub Pages.

How it works:

- Source content stays in `output/site`
- PDFs stay in `output/pdf`
- `npm run pages:build` assembles a Pages-ready `dist` directory
- `.github/workflows/deploy-pages.yml` deploys `dist` to GitHub Pages on every push to `main`

Build the Pages artifact locally:

```bash
npm run pages:build
```

Generated output:

- `dist`: GitHub Pages publish directory

Important details:

- `dist/.nojekyll` is created so `__assets__` is not ignored by GitHub Pages
- Root index links are rewritten for project-site deployment under `/ACFWiki/`
- Existing mirrored pages already use relative asset links, so nested pages remain static-host friendly

Enable GitHub Pages in the repository:

1. Open repository `Settings`
2. Open `Pages`
3. Set `Source` to `GitHub Actions`
4. Push to `main` or manually run the `Deploy GitHub Pages` workflow

Expected published URL:

```text
https://1206660.github.io/ACFWiki/
```

## Configuration

Optional environment variables:

```bash
SLIMWIKI_START_URL=https://slimwiki.com/dark-tower-int/acfu/welcome
SLIMWIKI_PAGE_PREFIX=/dark-tower-int/acfu
HOST=0.0.0.0
PORT=80
LOCAL_WIKI_HOME=/dark-tower-int/acfu/welcome/
```

Meaning:

- `SLIMWIKI_START_URL`: crawl entry page
- `SLIMWIKI_PAGE_PREFIX`: only mirror pages under this SlimWiki path prefix
- `HOST`: bind address for Express
- `PORT`: bind port for Express
- `LOCAL_WIKI_HOME`: redirect target for `/`

## Public Deployment

If the server should be reachable from the internet on port `80`:

1. Make sure the app is listening on `0.0.0.0:80`
2. Open inbound TCP `80` in your cloud firewall or security group
3. Open port `80` in the OS firewall if enabled
4. Verify access with `curl http://127.0.0.1:80/dark-tower-int/acfu/welcome/`

Common firewall examples:

```bash
sudo ufw allow 80/tcp
sudo ufw status
```

```bash
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --reload
```

## Run As A Service

Example `systemd` service:

```ini
[Unit]
Description=ACFWiki Local Mirror Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/root/Code/SlimWiki
ExecStart=/usr/bin/node /root/Code/SlimWiki/server.js
Restart=always
RestartSec=3
Environment=HOST=0.0.0.0
Environment=PORT=80
Environment=LOCAL_WIKI_HOME=/dark-tower-int/acfu/welcome/

[Install]
WantedBy=multi-user.target
```

Install and enable:

```bash
sudo tee /etc/systemd/system/acfwiki.service >/dev/null <<'EOF'
[Unit]
Description=ACFWiki Local Mirror Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/root/Code/SlimWiki
ExecStart=/usr/bin/node /root/Code/SlimWiki/server.js
Restart=always
RestartSec=3
Environment=HOST=0.0.0.0
Environment=PORT=80
Environment=LOCAL_WIKI_HOME=/dark-tower-int/acfu/welcome/

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now acfwiki
sudo systemctl status acfwiki
```

## Update Workflow

When you want to refresh the mirrored wiki content:

```bash
cd /root/Code/SlimWiki
git pull
npm install
npm run mirror
sudo systemctl restart acfwiki
```

If you do not use `systemd`, restart the Node process manually.

If you also use GitHub Pages:

```bash
cd /root/Code/SlimWiki
git pull
npm install
npm run mirror
git add output package-lock.json package.json scripts README.md .github
git commit -m "Refresh mirrored wiki"
git push
```

After the push, GitHub Actions will rebuild and redeploy Pages automatically.

## Git Push With SSH

This repo is configured to push with SSH.

Test SSH:

```bash
ssh -T git@github.com
```

Push:

```bash
git push -u origin main
```

## Notes

- First full crawl can take a while because it renders each page and downloads linked assets
- Output size can become large because PDFs and images are included in the repo
- If SlimWiki changes its frontend structure, the mirror script may need adjustments
