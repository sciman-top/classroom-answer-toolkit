import fs from "node:fs";
import http from "node:http";

// Windows retains a set of reserved ports (Hyper-V excluded port ranges and
// well-known service ports) where a listener can bind but Chrome refuses to
// connect. The renderer server retries on a free port instead.
const restrictedPorts = new Set([
  0,
  1,
  7,
  9,
  11,
  13,
  15,
  17,
  19,
  20,
  21,
  22,
  23,
  25,
  37,
  42,
  43,
  53,
  69,
  77,
  79,
  87,
  95,
  101,
  102,
  103,
  104,
  109,
  110,
  111,
  113,
  115,
  117,
  119,
  123,
  135,
  137,
  139,
  143,
  161,
  179,
  389,
  427,
  465,
  512,
  513,
  514,
  515,
  526,
  530,
  531,
  532,
  540,
  548,
  554,
  556,
  563,
  587,
  601,
  636,
  989,
  990,
  993,
  995,
  1719,
  1720,
  1723,
  2049,
  3659,
  4045,
  5060,
  5061,
  6000,
  6566,
  6665,
  6666,
  6667,
  6668,
  6669,
  6697,
  10080
]);

export async function createRendererServer({ pdfJsPath, pdfWorkerPath }) {
  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"></head>
<body>
<script type="module">
import * as pdfjsLib from "/pdf.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
window.pdfReview = { pdfjsLib };
window.pdfReviewReady = true;
</script>
</body>
</html>`;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const server = http.createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");

      if (url.pathname === "/" || url.pathname === "/index.html") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(html);
        return;
      }

      if (url.pathname === "/pdf.mjs") {
        response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
        fs.createReadStream(pdfJsPath).pipe(response);
        return;
      }

      if (url.pathname === "/pdf.worker.mjs") {
        response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
        fs.createReadStream(pdfWorkerPath).pipe(response);
        return;
      }

      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    });

    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Unable to start local PDF.js renderer server.");
    }

    if (restrictedPorts.has(address.port)) {
      await new Promise((resolve) => server.close(resolve));
      continue;
    }

    return {
      url: `http://127.0.0.1:${address.port}/`,
      close: () => new Promise((resolve) => server.close(resolve))
    };
  }

  throw new Error("Unable to start local PDF.js renderer server on an allowed port.");
}
