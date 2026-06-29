# Classroom Answer Toolkit

面向初中试卷参考答案的生成、校验、渲染与交付工具链。

Windows-first toolkit for generating, validating, and rendering junior-high exam answer sheets to Markdown, LaTeX, and PDF.

## Overview

This repository is centered on a local Windows workflow for turning answer content into classroom-ready and print-ready deliverables.

Current capabilities include:

- structured subject-pack assets for answer policies and profiles
- Markdown and LaTeX validation before rendering
- PDF rendering with real math output
- review-image generation for source PDFs and rendered answers
- diagram answer overlay and composition helpers
- lightweight workspace diagnostics through the WPF app

## Current Scope

- `physics-answer`: active junior-high physics answer workflow
- `math-answer`: experimental second-subject scaffold used to keep platform contracts subject-agnostic

The internal solution and project names still use `ClassroomToolkit`. The external repository-facing name is `Classroom Answer Toolkit`.

## Repository Layout

- `src/`: WPF app and .NET orchestration layers
- `scripts/`: bootstrap, toolchain check, publish, and packaging entry points
- `prompts/`: subject-pack assets, profiles, rules, manifests, and schemas
- `tools/latex-renderer/`: Markdown, LaTeX, render, review, and delivery toolchain
- `tools/answer-graphics/`: diagram-answer extraction and overlay pipeline
- `tools/ocr/`: local RapidOCR CPU path for poor scans and batch OCR
- `eval/`: fixed datasets, baselines, and regression outputs
- `tests/`: xUnit and FluentAssertions coverage for workspace and app behavior

## Requirements

- Windows
- .NET SDK `10.0.301`
- Node.js and npm
- Python `3.12+`
- Edge, Chrome, or Chromium

## Quick Start

Run from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/bootstrap.ps1
powershell -ExecutionPolicy Bypass -File scripts/check-toolchain.ps1
dotnet build ClassroomToolkit.sln -c Debug
dotnet test tests/ClassroomToolkit.Tests/ClassroomToolkit.Tests.csproj -c Debug
dotnet run --project src/ClassroomToolkit.App/ClassroomToolkit.App.csproj
```

## Common Workflows

Render or deliver an answer after the Markdown is ready:

```powershell
npm --prefix tools/latex-renderer run deliver -- "<answer.md>"
npm --prefix tools/latex-renderer run deliver -- "<answer.md>" --profile compact
```

Run the focused local checks:

```powershell
npm --prefix tools/latex-renderer run smoke
npm --prefix tools/answer-graphics run smoke
```

## Status

The repository is currently strongest on the junior-high physics answer path. Multi-subject support is present at the asset and contract level, but still incomplete at the product level.
