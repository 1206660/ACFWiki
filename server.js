const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 80);
const outputRoot = path.join(process.cwd(), "output");
const siteRoot = path.join(outputRoot, "site");
const pdfRoot = path.join(outputRoot, "pdf");
const defaultPath = process.env.LOCAL_WIKI_HOME || "/dark-tower-int/acfu/welcome/";

app.use("/pdf", express.static(pdfRoot, { extensions: ["pdf"] }));
app.use(express.static(siteRoot, { extensions: ["html"] }));

app.use((req, res, next) => {
  const cleanPath = req.path.replace(/\/+$/, "");
  const filePath = path.join(siteRoot, cleanPath, "index.html");

  if (cleanPath && fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }

  if (req.path === "/" && fs.existsSync(path.join(siteRoot, "index.html"))) {
    return res.redirect(defaultPath);
  }

  return next();
});

app.listen(port, host, () => {
  console.log(`Local wiki ready at http://${host}:${port}${defaultPath}`);
});
