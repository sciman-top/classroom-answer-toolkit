import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseArgvFlags } from "../shared.mjs";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "..", "..");
const assembliesRoot = path.join(repoRoot, "prompts", "specs", "assemblies");

function parseArgs(argv) {
  return parseArgvFlags(argv, {
    stringFlags: { assembly: true },
    booleanFlags: { all: true, check: true },
    defaults: { all: false, assembly: null, check: false }
  });
}

function normalizeNewlines(text) {
  // Strip a UTF-8 BOM too: it would otherwise glue onto the first heading and
  // fail the title match with a misleading error.
  return String(text).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function listAssemblyFiles() {
  if (!fs.existsSync(assembliesRoot)) {
    return [];
  }

  return fs
    .readdirSync(assembliesRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(assembliesRoot, entry.name))
    .sort((left, right) => left.localeCompare(right, "en"));
}

function resolveAssemblyFile(assemblyRef) {
  if (!assemblyRef) {
    return null;
  }

  const directPath = path.join(assembliesRoot, `${assemblyRef}.json`);
  if (fs.existsSync(directPath)) {
    return directPath;
  }

  return listAssemblyFiles().find((filePath) => {
    const assembly = readJson(filePath);
    return assembly.assemblyId === assemblyRef;
  }) ?? null;
}

function extractTitleAndBody(markdown) {
  const normalized = normalizeNewlines(markdown);
  const lines = normalized.split("\n");
  const firstLine = lines[0] ?? "";
  const titleMatch = firstLine.match(/^#\s+(.+)$/u);
  if (!titleMatch) {
    throw new Error("Markdown source is missing first-level heading.");
  }

  const body = lines.slice(1).join("\n").trimStart();
  return {
    title: titleMatch[1].trim(),
    body
  };
}

function parseVersionFromFileName(filePath) {
  const match = path.basename(filePath).match(/-v(\d+\.\d+)\.md$/u);
  return match ? `v${match[1]}` : null;
}

function makeGeneratedHeader({ title, assemblyPath, subjectPack, sourceLayers, outputVersion, kind }) {
  const layerSummary = sourceLayers
    .map((layer) => {
      const version = parseVersionFromFileName(layer.absolutePath);
      return version ? `${layer.label}(${version})` : layer.label;
    })
    .join("、");

  return [
    `# ${title}`,
    "",
    `> 生成方式：自动汇编生成，禁止手改。`,
    `> 目标 subject-pack：\`${subjectPack}\`。`,
    `> 汇编清单：\`${path.relative(repoRoot, assemblyPath).replace(/\\/g, "/")}\`。`,
    `> 产物类型：${kind}。`,
    `> 汇编层：${layerSummary}。`,
    `> 输出版本：${outputVersion}。`,
    "",
    "---",
    ""
  ].join("\n");
}

function createSection(label, markdown) {
  const { body } = extractTitleAndBody(markdown);
  return [
    `## ${label}`,
    "",
    body.trim(),
    ""
  ].join("\n");
}

function buildFullContent(assemblyPath, assembly, sourceLayers) {
  const title = `试卷参考答案交付规范-${assembly.subjectLabel}-完整版 ${assembly.outputVersion}`;
  const header = makeGeneratedHeader({
    title,
    assemblyPath,
    subjectPack: assembly.subjectPack,
    sourceLayers,
    outputVersion: assembly.outputVersion,
    kind: "完整版"
  });

  const sections = sourceLayers.map((layer) => createSection(layer.label, layer.markdown)).join("\n");
  return `${header}${sections}`.trimEnd() + "\n";
}

function buildEntryContent(assemblyPath, assembly, entryMarkdown, sourceLayers) {
  const title = `试卷参考答案交付规范-${assembly.subjectLabel}-调用版 ${assembly.outputVersion}`;
  const header = makeGeneratedHeader({
    title,
    assemblyPath,
    subjectPack: assembly.subjectPack,
    sourceLayers,
    outputVersion: assembly.outputVersion,
    kind: "调用版"
  });
  const { body } = extractTitleAndBody(entryMarkdown);
  return `${header}${body.trim()}\n`;
}

export function generateAssemblyOutputs(assemblyFilePath) {
  const assembly = readJson(assemblyFilePath);
  const assemblyDir = path.dirname(assemblyFilePath);
  const sourceLayers = (assembly.sourceLayers ?? []).map((layer) => {
    const absolutePath = path.resolve(assemblyDir, layer.path);
    return {
      ...layer,
      absolutePath,
      markdown: fs.readFileSync(absolutePath, "utf8")
    };
  });

  const entrySourcePath = path.resolve(assemblyDir, assembly.entrySource);
  const fullContent = buildFullContent(assemblyFilePath, assembly, sourceLayers);
  const entryContent = buildEntryContent(
    assemblyFilePath,
    assembly,
    fs.readFileSync(entrySourcePath, "utf8"),
    sourceLayers
  );

  const fullOutputPath = path.resolve(assemblyDir, assembly.fullOutput);
  const entryOutputPath = path.resolve(assemblyDir, assembly.entryOutput);

  return {
    assembly,
    outputs: [
      { path: fullOutputPath, content: fullContent },
      { path: entryOutputPath, content: entryContent }
    ]
  };
}

export function checkAssemblyOutputs(assemblyFilePath) {
  const generated = generateAssemblyOutputs(assemblyFilePath);
  const mismatches = [];

  for (const output of generated.outputs) {
    if (!fs.existsSync(output.path)) {
      mismatches.push(`Missing generated file: ${path.relative(repoRoot, output.path).replace(/\\/g, "/")}`);
      continue;
    }

    const existing = normalizeNewlines(fs.readFileSync(output.path, "utf8"));
    const expected = normalizeNewlines(output.content);
    if (existing !== expected) {
      mismatches.push(`Generated file drift: ${path.relative(repoRoot, output.path).replace(/\\/g, "/")}`);
    }
  }

  return mismatches;
}

export function writeAssemblyOutputs(assemblyFilePath) {
  const generated = generateAssemblyOutputs(assemblyFilePath);
  for (const output of generated.outputs) {
    fs.mkdirSync(path.dirname(output.path), { recursive: true });
    fs.writeFileSync(output.path, output.content, "utf8");
  }

  return generated.outputs.map((output) => path.relative(repoRoot, output.path).replace(/\\/g, "/"));
}

export function assembleAll(options = {}) {
  const assemblyFiles = options.assemblyFilePath
    ? [options.assemblyFilePath]
    : listAssemblyFiles();

  if (!assemblyFiles.length) {
    throw new Error("No assembly files found.");
  }

  if (options.check) {
    const mismatches = assemblyFiles.flatMap((filePath) => checkAssemblyOutputs(filePath));
    if (mismatches.length) {
      throw new Error(mismatches.join("\n"));
    }

    return [];
  }

  return assemblyFiles.flatMap((filePath) => writeAssemblyOutputs(filePath));
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  // An unknown --assembly reference must fail loudly; silently falling back to
  // "all assemblies" turns a typo into a false-green targeted check.
  if (options.assembly && !resolveAssemblyFile(options.assembly)) {
    throw new Error(`Unknown assembly: ${options.assembly}`);
  }
  const assemblyFilePath = options.assembly ? resolveAssemblyFile(options.assembly) : null;
  const written = assembleAll({
    assemblyFilePath,
    check: options.check
  });

  if (!options.check) {
    for (const filePath of written) {
      console.log(filePath);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
