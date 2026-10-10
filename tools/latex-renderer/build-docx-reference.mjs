import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, zipSync } from "fflate";
import { isDirectInvocation } from "../shared.mjs";

// Builds the DOCX reference template used by export-answer-docx.mjs so exported
// DOCX files match the classroom PDF profile: A4, 16/17mm margins, Microsoft
// YaHei body at 14pt with 1.55 line height, H1 21pt, H2 16pt in #164A7A.
// The template is generated from pandoc's default reference.docx; committed as
// assets/docx-reference-classroom.docx and reproducible with `run build:docx-reference`.

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.join(toolDir, "assets", "docx-reference-classroom.docx");

const PAGE = { widthTwips: 11906, heightTwips: 16838 }; // A4 portrait
const MARGIN = {
  topTwips: 907, // 16mm
  bottomTwips: 907, // 16mm
  leftTwips: 964, // 17mm
  rightTwips: 964 // 17mm
};
const BODY_FONT = "Microsoft YaHei";
const BODY_FONT_XML = `<w:rFonts w:ascii="${BODY_FONT}" w:eastAsia="${BODY_FONT}" w:hAnsi="${BODY_FONT}" w:cs="${BODY_FONT}" />`;

function loadDefaultReferenceDocx() {
  const probe = spawnSync("pandoc", ["--print-default-data-file", "reference.docx"], {
    encoding: "buffer",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  });
  if (probe.error || probe.status !== 0) {
    throw new Error(`Failed to read pandoc's default reference.docx: ${String(probe.stderr)}`);
  }
  return unzipSync(new Uint8Array(probe.stdout));
}

function patchStylesXml(stylesXml) {
  let styles = stylesXml;

  const docDefaultsOriginal = styles.match(/<w:rPrDefault>[\s\S]*?<\/w:rPrDefault>/)?.[0];
  if (!docDefaultsOriginal) {
    throw new Error("Unexpected pandoc reference.docx: <w:rPrDefault> not found.");
  }
  const docDefaultsPatched = docDefaultsOriginal
    .replace(/<w:rFonts[^/]*\/>/, BODY_FONT_XML)
    .replace(/<w:sz w:val="\d+" \/>/, '<w:sz w:val="28" />') // 14pt body
    .replace(/<w:szCs w:val="\d+" \/>/, '<w:szCs w:val="28" />');
  styles = styles.replace(docDefaultsOriginal, docDefaultsPatched);

  // 7pt paragraph gap (classroom profile) with 1.55 line height.
  styles = styles.replace(
    /<w:pPrDefault>\s*<w:pPr>\s*<w:spacing w:after="\d+" \/>\s*<\/w:pPr>\s*<\/w:pPrDefault>/,
    '<w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="372" w:lineRule="auto" /></w:pPr></w:pPrDefault>'
  );

  const headingPatch = (styleId, sizeHalfPoints, color) => {
    const original = styles.match(new RegExp(`<w:style [^>]*w:styleId="${styleId}"[\\s\\S]*?<\\/w:style>`))?.[0];
    if (!original) {
      throw new Error(`Unexpected pandoc reference.docx: style ${styleId} not found.`);
    }
    const patched = original
      .replace(/<w:rFonts[\s\S]*?\/>/, BODY_FONT_XML)
      .replace(/<w:color[^/]*\/>/, color ? `<w:color w:val="${color}" />` : "")
      .replace(/<w:sz w:val="\d+" \/>/, `<w:sz w:val="${sizeHalfPoints}" />`)
      .replace(/<w:szCs w:val="\d+" \/>/, `<w:szCs w:val="${sizeHalfPoints}" />`);
    return styles.replace(original, patched);
  };

  // H1 21pt in body ink; H2 16pt in the PDF's section blue; H3 follows H2 ink.
  styles = headingPatch("Heading1", 42, "111111");
  styles = headingPatch("Heading2", 32, "164A7A");
  styles = headingPatch("Heading3", 28, "164A7A");
  return styles;
}

function patchDocumentXml(documentXml) {
  const sectPr = documentXml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/)?.[0];
  if (!sectPr) {
    throw new Error("Unexpected pandoc reference.docx: <w:sectPr> not found.");
  }
  const pageSetup =
    `<w:pgSz w:w="${PAGE.widthTwips}" w:h="${PAGE.heightTwips}" />`
    + `<w:pgMar w:top="${MARGIN.topTwips}" w:right="${MARGIN.rightTwips}" w:bottom="${MARGIN.bottomTwips}" `
    + `w:left="${MARGIN.leftTwips}" w:header="709" w:footer="709" w:gutter="0" />`;
  const patchedSectPr = sectPr.replace(/<\/w:sectPr>$/, `${pageSetup}</w:sectPr>`);
  return documentXml.replace(sectPr, patchedSectPr);
}

function main() {
  const files = loadDefaultReferenceDocx();
  const stylesXml = patchStylesXml(Buffer.from(files["word/styles.xml"]).toString("utf8"));
  const documentXml = patchDocumentXml(Buffer.from(files["word/document.xml"]).toString("utf8"));
  assertPatchApplied("docDefaults body font", /<w:rPrDefault>[\s\S]*?w:ascii="Microsoft YaHei"/.test(stylesXml));
  assertPatchApplied("body 14pt", /<w:rPrDefault>[\s\S]*?<w:sz w:val="28" \/>/.test(stylesXml));
  assertPatchApplied("Heading1 patch", /w:styleId="Heading1"[\s\S]*?w:val="111111"[\s\S]*?w:val="42"/.test(stylesXml));
  assertPatchApplied("Heading2 patch", /w:styleId="Heading2"[\s\S]*?w:val="164A7A"[\s\S]*?w:val="32"/.test(stylesXml));
  assertPatchApplied("A4 page setup", /<w:pgSz w:w="11906" w:h="16838" \/>/.test(documentXml));

  files["word/styles.xml"] = new TextEncoder().encode(stylesXml);
  files["word/document.xml"] = new TextEncoder().encode(documentXml);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, zipSync(files, { level: 9 }));
  console.log(`Wrote ${outputPath} (${fs.statSync(outputPath).size} bytes).`);
}

function assertPatchApplied(label, condition) {
  if (!condition) {
    throw new Error(`reference.docx patch did not apply: ${label}. pandoc's default template may have changed.`);
  }
}

if (isDirectInvocation(import.meta.url)) {
  main();
}
