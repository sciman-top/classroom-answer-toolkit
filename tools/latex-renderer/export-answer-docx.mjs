import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { mapInlineMath } from "./inline-math.mjs";
import { parseArgvFlags } from "../shared.mjs";

// Exports an answer Markdown file to DOCX with native Word (OMML) equations via
// pandoc. The PDF renderer keeps LaTeX math through KaTeX; pandoc converts the
// same LaTeX math regions into OMML, so the DOCX shows real Word equations with
// the same content as the delivered Markdown and PDF.

const PANDOC_MIN_MAJOR = 3;
const DEFAULT_REFERENCE = path.join(path.dirname(fileURLToPath(import.meta.url)), "assets", "docx-reference-classroom.docx");
// Mirrors replaceMath in render-md-latex.mjs: display math is masked first, the
// `\(...\)` inline form is masked the same way its normalization would consume
// it, then the shared inline scanner counts the remaining `$...$` regions.
export function countMathRegions(markdown) {
  let regions = 0;
  const mask = () => {
    regions += 1;
    return " ";
  };
  let text = markdown.replace(/\$\$([\s\S]+?)\$\$/g, mask);
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, mask);
  text = text.replace(/\\\([\s\S]+?\\\)/g, mask);
  mapInlineMath(text, () => {
    regions += 1;
    return " ";
  });
  return regions;
}

function readDocumentXml(docxPath) {
  const files = unzipSync(fs.readFileSync(docxPath));
  const documentXml = files["word/document.xml"];
  if (!documentXml) {
    throw new Error(`word/document.xml missing from ${docxPath}; not a valid DOCX.`);
  }
  return Buffer.from(documentXml).toString("utf8");
}

function countOmathElements(documentXml) {
  return (documentXml.match(/<m:oMath(?:\s|>)/g) ?? []).length;
}

function resolvePandoc() {
  const probe = spawnSync("pandoc", ["--version"], { encoding: "utf8", windowsHide: true });
  if (probe.error || probe.status !== 0) {
    throw new Error(
      "pandoc was not found on PATH. Install pandoc 3+ (winget install --id JohnMacFarlane.Pandoc) "
      + "or set PATH to its location; it converts LaTeX math into native OMML equations."
    );
  }
  const versionLine = probe.stdout.split("\n", 1)[0] ?? "";
  const major = Number.parseInt(versionLine.replace(/^pandoc(?:\.exe)?\s+v?/, ""), 10);
  if (!Number.isFinite(major) || major < PANDOC_MIN_MAJOR) {
    throw new Error(`pandoc ${versionLine.trim()} is too old; pandoc ${PANDOC_MIN_MAJOR}+ is required.`);
  }
  return versionLine.trim();
}

export function exportAnswerDocx({ markdownPath, outputPath, verify = true, reference = DEFAULT_REFERENCE }) {
  if (!fs.existsSync(markdownPath)) {
    throw new Error(`Answer Markdown not found: ${markdownPath}`);
  }
  const pandocVersion = resolvePandoc();
  const resolvedOutput = outputPath ?? path.join(
    path.dirname(markdownPath),
    `${path.basename(markdownPath, path.extname(markdownPath))}.docx`
  );
  fs.mkdirSync(path.dirname(path.resolve(resolvedOutput)), { recursive: true });

  const args = [
    "--from", "markdown+tex_math_dollars+tex_math_single_backslash",
    "--to", "docx",
    "--resource-path", path.dirname(markdownPath),
    "--output", resolvedOutput
  ];
  if (reference) {
    if (!fs.existsSync(reference)) {
      throw new Error(`DOCX reference template not found: ${reference}. Run: npm --prefix tools/latex-renderer run build:docx-reference`);
    }
    args.push("--reference-doc", reference);
  }
  args.push(markdownPath);
  const run = spawnSync("pandoc", args, { encoding: "utf8", windowsHide: true });
  if (run.error) {
    throw new Error(`Failed to launch pandoc: ${run.error.message}`);
  }
  if (run.status !== 0) {
    throw new Error(`pandoc exited with status ${run.status}: ${run.stderr.trim()}`);
  }

  let mathReport;
  if (verify) {
    const markdown = fs.readFileSync(markdownPath, "utf8");
    const expected = countMathRegions(markdown);
    const actual = countOmathElements(readDocumentXml(resolvedOutput));
    if (actual !== expected) {
      throw new Error(
        `DOCX math verification failed for ${path.basename(resolvedOutput)}: `
        + `Markdown has ${expected} math region(s) but DOCX contains ${actual} m:oMath element(s). `
        + "A delimiter pandoc could not parse would leak literal LaTeX into the DOCX."
      );
    }
    mathReport = { expected, actual };
  }

  return { outputPath: resolvedOutput, pandocVersion, mathReport };
}

function printUsage() {
  console.log("Usage: node export-answer-docx.mjs --markdown <答案.md> [--output <答案.docx>] [--reference <模板.docx>] [--no-reference] [--no-verify]");
}

function main() {
  const options = parseArgvFlags(process.argv.slice(2), {
    stringFlags: { markdown: true, output: true, reference: true },
    booleanFlags: { "no-verify": true, "no-reference": true },
    unknownFlag: "error",
    help: true
  });
  if (options.help) {
    printUsage();
    return;
  }
  if (!options.markdown) {
    printUsage();
    process.exitCode = 2;
    return;
  }

  const result = exportAnswerDocx({
    markdownPath: options.markdown,
    outputPath: options.output,
    verify: !options["no-verify"],
    reference: options["no-reference"] ? null : (options.reference ?? DEFAULT_REFERENCE)
  });
  const mathSummary = result.mathReport
    ? ` ${result.mathReport.actual}/${result.mathReport.expected} math region(s) verified as OMML.`
    : "";
  console.log(`Exported ${result.outputPath} with ${result.pandocVersion}.${mathSummary}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
