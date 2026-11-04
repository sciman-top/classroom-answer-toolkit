using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using FluentAssertions;
using Xunit;

namespace ClassroomToolkit.Tests.Toolchain;

[Trait("Gate", "ToolchainIntegration")]
public sealed class ArchiveDeliveryRunScriptTests
{
    [Fact]
    public async Task RequiresAnExplicitArchiveRootInsteadOfAMachineSpecificDefault()
    {
        var (sandbox, runDirectory, scriptPath) = CreateSandbox();
        try
        {
            var result = await RunScriptWithoutArchiveRootAsync(scriptPath, sandbox, runDirectory);

            result.ExitCode.Should().NotBe(0);
            result.Output.Should().Contain("ArchiveRoot");
        }
        finally
        {
            DeleteDirectory(sandbox);
        }
    }

    [Fact]
    public async Task RejectsAnArchiveRootThatIsADriveRoot()
    {
        var (sandbox, runDirectory, scriptPath) = CreateSandbox();
        try
        {
            var driveRoot = Path.GetPathRoot(sandbox)!;
            var result = await RunScriptAsync(scriptPath, sandbox, driveRoot, runDirectory);

            result.ExitCode.Should().NotBe(0);
            result.NormalizedOutput.Should().Contain("not a drive root");
        }
        finally
        {
            DeleteDirectory(sandbox);
        }
    }

    [Fact]
    public async Task RejectsRunDirectoriesOutsideTheDeliveriesRoot()
    {
        var (sandbox, _, scriptPath) = CreateSandbox();
        try
        {
            var siblingRun = Path.Combine(sandbox, "正式交付-fake", "run-b");
            var result = await RunScriptAsync(scriptPath, sandbox, Path.Combine(sandbox, "archive-own"),
                siblingRun);

            result.ExitCode.Should().NotBe(0);
            result.Output.Should().Contain("must be a direct child");
            Directory.Exists(Path.Combine(sandbox, "archive-own", "正式交付", "run-b")).Should().BeFalse();
        }
        finally
        {
            DeleteDirectory(sandbox);
        }
    }

    [Fact]
    public async Task RejectsReArchiveWhenPayloadDriftedFromManifestHash()
    {
        var (sandbox, runDirectory, scriptPath) = CreateSandbox();
        try
        {
            var archiveRoot = Path.Combine(sandbox, "archive-drift");
            var first = await RunScriptAsync(scriptPath, sandbox, archiveRoot, runDirectory);
            first.ExitCode.Should().Be(0);
            File.ReadAllLines(Path.Combine(archiveRoot, "ARCHIVE-MANIFEST.txt")).Should().HaveCount(12);

            DeleteDirectory(Path.Combine(archiveRoot, "正式交付", "run-a"));
            File.WriteAllText(Path.Combine(runDirectory, "file-1.md"), "drifted content");

            var second = await RunScriptAsync(scriptPath, sandbox, archiveRoot, runDirectory);

            second.ExitCode.Should().NotBe(0);
            second.Output.Should().Contain("drifted from the manifest hash");
            Directory.Exists(Path.Combine(archiveRoot, "正式交付", "run-a")).Should().BeFalse();
        }
        finally
        {
            DeleteDirectory(sandbox);
        }
    }

    [Fact]
    public async Task RollsBackPartialArchiveWhenCopyFailsMidRun()
    {
        var (sandbox, runDirectory, scriptPath) = CreateSandbox();
        FileStream? lockStream = null;
        try
        {
            var archiveRoot = Path.Combine(sandbox, "archive-rollback");
            lockStream = new FileStream(
                Path.Combine(runDirectory, "file-2.json"),
                FileMode.Open, FileAccess.Read, FileShare.None);

            var failed = await RunScriptAsync(scriptPath, sandbox, archiveRoot, runDirectory);

            failed.ExitCode.Should().NotBe(0);
            Directory.Exists(Path.Combine(archiveRoot, "正式交付", "run-a")).Should().BeFalse();

            lockStream.Dispose();
            lockStream = null;

            var retried = await RunScriptAsync(scriptPath, sandbox, archiveRoot, runDirectory);
            retried.ExitCode.Should().Be(0);
            File.ReadAllLines(Path.Combine(archiveRoot, "ARCHIVE-MANIFEST.txt")).Should().HaveCount(12);
        }
        finally
        {
            lockStream?.Dispose();
            DeleteDirectory(sandbox);
        }
    }

    [Fact]
    public async Task PreservesRelativeNamesWhenRunDirectoryHasTrailingSeparator()
    {
        var (sandbox, runDirectory, scriptPath) = CreateSandbox();
        try
        {
            var archiveRoot = Path.Combine(sandbox, "archive-trailing");
            var result = await RunScriptAsync(scriptPath, sandbox, archiveRoot, runDirectory + Path.DirectorySeparatorChar);

            result.ExitCode.Should().Be(0);
            File.Exists(Path.Combine(archiveRoot, "正式交付", "run-a", "file-1.md")).Should().BeTrue();
            File.Exists(Path.Combine(archiveRoot, "正式交付", "run-a", "sub", "page.pdf")).Should().BeTrue();
            File.Exists(Path.Combine(archiveRoot, "ARCHIVE-MANIFEST.txt")).Should().BeTrue();
            File.ReadAllLines(Path.Combine(archiveRoot, "ARCHIVE-MANIFEST.txt"))
                .Should().Contain(line => line.Contains("正式交付/run-a/file-1.md"));
        }
        finally
        {
            DeleteDirectory(sandbox);
        }
    }

    [Fact]
    public async Task RejectsArchivingAFailedWorkflowRun()
    {
        var (sandbox, runDirectory, scriptPath) = CreateSandbox();
        try
        {
            WriteWorkflowReceipt(Path.Combine(runDirectory, "run-a.workflow-run.json"), "failed");
            var archiveRoot = Path.Combine(sandbox, "archive-failed");

            var result = await RunScriptAsync(scriptPath, sandbox, archiveRoot, runDirectory);

            result.ExitCode.Should().NotBe(0);
            result.Output.Should().Contain("workflow-run status is 'failed'");
            Directory.Exists(Path.Combine(archiveRoot, "正式交付", "run-a")).Should().BeFalse();
        }
        finally
        {
            DeleteDirectory(sandbox);
        }
    }

    private static void WriteWorkflowReceipt(string receiptPath, string status)
    {
        var runDirectory = Path.GetDirectoryName(receiptPath)!;
        var basePath = Path.Combine(runDirectory, "run-a");
        var baseName = Path.GetFileName(basePath);
        if (status != "succeeded")
        {
            File.WriteAllText(receiptPath, $$"""
                {
                  "schemaVersion": "1.0",
                  "kind": "live-answer-workflow-run",
                  "runId": "archive-failed-fixture",
                  "status": "{{status}}",
                  "startedAt": "{{DateTimeOffset.UtcNow.AddMinutes(-1):O}}",
                  "finishedAt": "{{DateTimeOffset.UtcNow:O}}",
                  "inputs": {
                    "sourcePdf": null,
                    "referencePdf": null,
                    "prompt": null,
                    "blindFocusRegions": null,
                    "visualAuditFocusRegions": null,
                    "configEnv": null
                  },
                  "options": {
                    "provider": "all",
                    "subjectPack": "junior-physics-answer",
                    "profile": "classroom",
                    "blindQualityProfile": "auto",
                    "semanticQualityProfile": "auto",
                    "visualQualityProfile": "auto",
                    "referenceQualityProfile": "auto",
                    "visualDetail": "original",
                    "maxOutputTokens": 24000,
                    "timeoutMs": 600000,
                    "reviewScale": 2,
                    "workflowReviewScale": 2,
                    "visualAuditScale": 4,
                    "blindFocusRegionsFile": null,
                    "visualAuditFocusRegionsFile": null,
                    "skipVisualAudit": true,
                    "keepReview": true,
                    "useGatewayProxy": false,
                    "allowCloudEgress": false,
                    "configEnvFile": "fixture.env",
                    "optionsFingerprint": "{{new string('b', 64)}}"
                  },
                  "phases": {
                    "blindGeneration": { "status": "pending", "summaryPath": null, "artifactPath": null, "summary": null, "artifact": null },
                    "semanticFindings": { "status": "pending", "summaryPath": null, "artifactPath": null, "summary": null, "artifact": null },
                    "semanticMerge": { "status": "pending", "summaryPath": null, "artifactPath": null, "summary": null, "artifact": null },
                    "visualFindings": { "status": "skipped", "summaryPath": null, "artifactPath": null, "summary": null, "artifact": null },
                    "visualMerge": { "status": "skipped", "summaryPath": null, "artifactPath": null, "summary": null, "artifact": null },
                    "referenceReview": { "status": "skipped", "summaryPath": null, "artifactPath": null, "summary": null, "artifact": null },
                    "delivery": { "status": "pending", "summaryPath": null, "artifactPath": null, "summary": null, "artifact": null }
                  },
                  "artifacts": [],
                  "resume": null,
                  "diagnostics": {
                    "retainedWorkRoot": "{{Path.Combine(Path.GetTempPath(), "ClassroomToolkit-ArchiveScript", "diagnostics-" + Guid.NewGuid().ToString("N")).Replace("\\", "/")}}"
                  },
                  "error": "fixture failure"
                }
                """);
            return;
        }
        using var receipt = JsonDocument.Parse(BuildVerifiedRun(basePath, baseName));
        var receiptElement = receipt.RootElement.Clone();
        var artifactPath = receiptElement.GetProperty("phases").GetProperty("delivery").GetProperty("artifactPath").GetString()!;
        var deliveryManifest = artifactPath.Replace(".pdf", ".delivery-manifest.json");
        var reviewManifest = Path.Combine(Path.GetDirectoryName(deliveryManifest)!,
            Path.GetFileName(deliveryManifest).Replace(".delivery-manifest.json", ".review"), "manifest.json");
        var reviewDocument = JsonDocument.Parse(File.ReadAllText(reviewManifest)).RootElement.Clone();
        var reviewAsDictionary = new Dictionary<string, object?>();
        foreach (var property in reviewDocument.EnumerateObject()) reviewAsDictionary[property.Name] = property.Value.Clone();
        reviewAsDictionary["inputPath"] = "../run-a.pdf";
        reviewAsDictionary["inputSha256"] = Hash(File.ReadAllBytes($"{basePath}.pdf"));
        reviewAsDictionary.Remove("outputDir");
        File.WriteAllText(reviewManifest, JsonSerializer.Serialize(reviewAsDictionary));
        using var manifestDocument = JsonDocument.Parse(File.ReadAllText(deliveryManifest));
        var manifestAsDictionary = new Dictionary<string, object?>();
        foreach (var property in manifestDocument.RootElement.EnumerateObject()) manifestAsDictionary[property.Name] = property.Value.Clone();
        var reviewBytes = File.ReadAllBytes(reviewManifest);
        var integrity = ((JsonElement)manifestAsDictionary["integrity"]!).Clone();
        var integrityDictionary = new Dictionary<string, object?>();
        foreach (var property in integrity.EnumerateObject()) integrityDictionary[property.Name] = property.Value.Clone();
        var reviewFiles = new List<object?>();
        foreach (var entry in ((JsonElement)integrityDictionary["reviewFiles"]!).EnumerateArray())
        {
            if (entry.GetProperty("path").GetString()!.EndsWith("manifest.json"))
            {
                reviewFiles.Add(new { path = entry.GetProperty("path").GetString(), bytes = reviewBytes.Length, sha256 = Hash(reviewBytes) });
            }
            else
            {
                reviewFiles.Add(entry.Clone());
            }
        }
        integrityDictionary["reviewFiles"] = reviewFiles;
        manifestAsDictionary["integrity"] = integrityDictionary;
        File.WriteAllText(deliveryManifest, JsonSerializer.Serialize(manifestAsDictionary));
        var manifestBytes = File.ReadAllBytes(deliveryManifest);
        var receiptRoot = new Dictionary<string, object?>();
        foreach (var property in receiptElement.EnumerateObject()) receiptRoot[property.Name] = property.Value.Clone();
        receiptRoot["phases"] = new Dictionary<string, object?>
        {
            ["blindGeneration"] = receiptElement.GetProperty("phases").GetProperty("blindGeneration").Clone(),
            ["semanticFindings"] = receiptElement.GetProperty("phases").GetProperty("semanticFindings").Clone(),
            ["semanticMerge"] = receiptElement.GetProperty("phases").GetProperty("semanticMerge").Clone(),
            ["visualFindings"] = receiptElement.GetProperty("phases").GetProperty("visualFindings").Clone(),
            ["visualMerge"] = receiptElement.GetProperty("phases").GetProperty("visualMerge").Clone(),
            ["referenceReview"] = receiptElement.GetProperty("phases").GetProperty("referenceReview").Clone(),
            ["delivery"] = new Dictionary<string, object?>
            {
                ["status"] = "completed",
                ["summaryPath"] = null,
                ["artifactPath"] = artifactPath,
                ["summary"] = null,
                ["artifact"] = receiptElement.GetProperty("phases").GetProperty("delivery").GetProperty("artifact").Clone()
            }
        };
        var artifacts = new List<object?>();
        foreach (var artifact in receiptElement.GetProperty("artifacts").EnumerateArray())
        {
            artifacts.Add(artifact.GetProperty("path").GetString()!.EndsWith("delivery-manifest.json", StringComparison.Ordinal)
                ? new { path = deliveryManifest, bytes = manifestBytes.Length, sha256 = Hash(manifestBytes) }
                : artifact.Clone());
        }
        receiptRoot["artifacts"] = artifacts;
        using var stream = File.Create(receiptPath);
        System.Text.Json.JsonSerializer.Serialize(stream, receiptRoot);
    }

    private static string BuildVerifiedRun(string basePath, string baseName)
    {
        var repoRoot = ToolchainTestHost.FindRepoRoot();
        var runRoot = Path.GetDirectoryName(basePath)!;
        var answerPath = $"{basePath}.delivery-input.md";
        var summaryPath = Path.Combine(runRoot, $"{baseName}.blind-generation.summary.json");
        var snapshotPath = $"{basePath}.snapshot.json";
        var manifestPath = $"{basePath}.delivery-manifest.json";
        var reviewRoot = $"{basePath}.review";
        var reviewManifestPath = Path.Combine(reviewRoot, "manifest.json");
        var reviewImagePath = Path.Combine(reviewRoot, "page-001.png");
        var source = $"{basePath}.audit-source.pdf";
        Directory.CreateDirectory(reviewRoot);
        File.WriteAllText(answerPath, "# 物理参考答案\n\n1. A\n");
        File.WriteAllText($"{basePath}.pdf", "%PDF-source-fixture");
        var snapshot = JsonSerializer.Serialize(new
        {
            snapshotId = "archive-fixture-snapshot",
            subjectPack = new { assetId = "junior-physics-answer", version = "v1" },
            activeProfile = new { name = "classroom" },
            rules = Array.Empty<object>()
        });
        File.WriteAllText(snapshotPath, snapshot);
        File.WriteAllBytes(reviewImagePath, Convert.FromBase64String(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="));
        var outputBytes = File.ReadAllBytes($"{basePath}.pdf");
        File.WriteAllText(reviewManifestPath, JsonSerializer.Serialize(new Dictionary<string, object?>
        {
            ["schemaVersion"] = "1.0",
            ["kind"] = "pdf-source-review",
            ["inputPath"] = $"../{baseName}.pdf",
            ["inputSha256"] = Hash(outputBytes),
            ["inputBytes"] = outputBytes.Length,
            ["pageCount"] = 1,
            ["selectedPages"] = new[] { 1 },
            ["pages"] = new[]
            {
                new { pageNumber = 1, kind = "page", horizontalIndex = 0, imagePath = "page-001.png" }
            }
        }));
        File.WriteAllText(summaryPath, JsonSerializer.Serialize(new
        {
            schemaVersion = "1.3",
            kind = "live-answer-generation-summary",
            generatedAt = DateTimeOffset.UtcNow.ToString("O"),
            provider = "fixture",
            model = "fixture",
            reasoningEffort = (string?)null,
            promptPath = "prompt.md",
            promptSha256 = new string('a', 64),
            mode = "blind_generation",
            sourcePageCount = 1,
            auditImageCount = 0,
            referencePageCount = 0,
            requestedVisualDetailMode = "original",
            providerVisualDetailMode = "original",
            routing = new
            {
                mode = "blind_generation",
                qualityProfile = "auto",
                requestedQualityProfile = "auto",
                resolvedQualityProfile = "auto",
                requestedPreset = "sol",
                resolvedPreset = "sol",
                activePreset = "sol",
                qualityDegraded = false,
                selectedRole = "fixture",
                orderedPresets = new[] { "sol" },
                orderedRoles = new[] { "fixture" },
                orderedQualityProfiles = new[] { "auto" },
                orderedExecutionSlots = new[] { 1 },
                executionSlot = 1,
                executionSlotCount = 1,
                target = "fixture",
                resolvedRole = "fixture",
                attemptedRoles = new[] { "fixture" }
            },
            candidatePath = (string?)null,
            candidateSha256 = (string?)null,
            candidateBaselinePath = (string?)null,
            candidateBaselineSha256 = (string?)null,
            semanticFindingsPath = (string?)null,
            semanticFindingsSha256 = (string?)null,
            auditFindingsPath = (string?)null,
            auditFindingsSha256 = (string?)null,
            sourceTextPath = (string?)null,
            sourceTextSha256 = (string?)null,
            referenceTextPath = (string?)null,
            referenceTextSha256 = (string?)null,
            referencePdfPath = (string?)null,
            referencePdfSha256 = (string?)null,
            pageCount = 1,
            pageImages = Array.Empty<object>(),
            outputPath = answerPath,
            outputSha256 = Hash(File.ReadAllBytes(answerPath)),
            answerCharacters = 8,
            referenceChoiceOverride = new { applied = false },
            semanticChoiceOverride = new { applied = false, questions = Array.Empty<int>() },
            attempts = new[]
            {
                new
                {
                    provider = "fixture", model = "fixture", reasoningEffort = (string?)null,
                    preset = "sol", qualityProfile = "auto", executionSlot = 1, status = 200,
                    retryAfterMs = (int?)null, ok = true, retryable = false, attemptNumber = 1,
                    durationMs = 1, requestBytes = 1, transport = (object?)null, error = ""
                }
            }
        }));
        var reviewManifestBytes = File.ReadAllBytes(reviewManifestPath);
        File.WriteAllText(manifestPath, JsonSerializer.Serialize(new
        {
            schemaVersion = "1.1",
            kind = "delivery-manifest",
            generatedAt = DateTimeOffset.UtcNow.ToString("O"),
            subjectPack = "junior-physics-answer",
            snapshotId = "archive-fixture-snapshot",
            snapshotPath = $"{baseName}.snapshot.json",
            snapshot = new { id = "archive-fixture-snapshot", version = "v1", profile = "classroom" },
            profile = "classroom",
            input = $"{baseName}.delivery-input.md",
            output = $"{baseName}.pdf",
            review = new
            {
                outputDir = $"{baseName}.review",
                manifestPath = $"{baseName}.review/manifest.json",
                scale = "2"
            },
            ocr = new { status = "not-requested" },
            graphics = new { items = Array.Empty<object>() },
            integrity = new
            {
                algorithm = "sha256",
                input = new { path = $"{baseName}.delivery-input.md", bytes = new FileInfo(answerPath).Length, sha256 = Hash(File.ReadAllBytes(answerPath)) },
                output = new { path = $"{baseName}.pdf", bytes = outputBytes.Length, sha256 = Hash(outputBytes) },
                snapshot = new { path = $"{baseName}.snapshot.json", bytes = new FileInfo(snapshotPath).Length, sha256 = Hash(File.ReadAllBytes(snapshotPath)) },
                reviewFiles = new object[]
                {
                    new { path = $"{baseName}.review/manifest.json", bytes = reviewManifestBytes.Length, sha256 = Hash(reviewManifestBytes) },
                    new { path = $"{baseName}.review/page-001.png", bytes = new FileInfo(reviewImagePath).Length, sha256 = Hash(File.ReadAllBytes(reviewImagePath)) }
                }
            },
            status = new { toolchainPassed = true, deliveryComplete = true, reviewArtifactReady = true }
        }));
        object Receipt(string path) => new
        {
            path,
            bytes = new FileInfo(path).Length,
            sha256 = Hash(File.ReadAllBytes(path))
        };
        var file = Receipt(answerPath);
        var summary = Receipt(summaryPath);
        var pdf = Receipt($"{basePath}.pdf");
        return JsonSerializer.Serialize(new Dictionary<string, object?>
        {
            ["schemaVersion"] = "1.0",
            ["kind"] = "live-answer-workflow-run",
            ["runId"] = "archive-fixture-run",
            ["status"] = "succeeded",
            ["startedAt"] = DateTimeOffset.UtcNow.AddMinutes(-1).ToString("O"),
            ["finishedAt"] = DateTimeOffset.UtcNow.ToString("O"),
            ["inputs"] = new Dictionary<string, object?>
            {
                ["sourcePdf"] = null, ["referencePdf"] = null, ["prompt"] = null,
                ["blindFocusRegions"] = null, ["visualAuditFocusRegions"] = null, ["configEnv"] = null
            },
            ["options"] = new Dictionary<string, object?>
            {
                ["provider"] = "all", ["subjectPack"] = "junior-physics-answer", ["profile"] = "classroom",
                ["blindQualityProfile"] = "auto", ["semanticQualityProfile"] = "auto",
                ["visualQualityProfile"] = "auto", ["referenceQualityProfile"] = "auto",
                ["visualDetail"] = "original", ["maxOutputTokens"] = 24000, ["timeoutMs"] = 600000,
                ["reviewScale"] = 2.0, ["workflowReviewScale"] = 2.0, ["visualAuditScale"] = 4.0,
                ["blindFocusRegionsFile"] = null, ["visualAuditFocusRegionsFile"] = null,
                ["skipVisualAudit"] = true, ["keepReview"] = true, ["useGatewayProxy"] = false,
                ["allowCloudEgress"] = false, ["configEnvFile"] = "fixture.env",
                ["optionsFingerprint"] = new string('b', 64)
            },
            ["phases"] = new Dictionary<string, object?>
            {
                ["blindGeneration"] = new { status = "completed", summaryPath, artifactPath = answerPath, summary, artifact = file },
                ["semanticFindings"] = new { status = "pending", summaryPath = (string?)null, artifactPath = (string?)null, summary = (object?)null, artifact = (object?)null },
                ["semanticMerge"] = new { status = "pending", summaryPath = (string?)null, artifactPath = (string?)null, summary = (object?)null, artifact = (object?)null },
                ["visualFindings"] = new { status = "skipped", summaryPath = (string?)null, artifactPath = (string?)null, summary = (object?)null, artifact = (object?)null },
                ["visualMerge"] = new { status = "skipped", summaryPath = (string?)null, artifactPath = (string?)null, summary = (object?)null, artifact = (object?)null },
                ["referenceReview"] = new { status = "skipped", summaryPath = (string?)null, artifactPath = (string?)null, summary = (object?)null, artifact = (object?)null },
                ["delivery"] = new { status = "completed", summaryPath = (string?)null, artifactPath = $"{basePath}.pdf", summary = (object?)null, artifact = pdf }
            },
            ["artifacts"] = new[] { file, Receipt(manifestPath), pdf },
            ["reviewEvidence"] = new
            {
                semantic = new { confirmedCorrections = Array.Empty<int>(), unresolvedQuestions = Array.Empty<int>() },
                visual = new { directCorrections = Array.Empty<int>(), unresolvedQuestions = Array.Empty<int>() },
                reference = new { correctedQuestions = Array.Empty<int>(), unresolvedQuestions = Array.Empty<int>() },
                unresolvedQuestions = Array.Empty<int>(), unresolvedReviewNotices = Array.Empty<string>()
            },
            ["resume"] = null,
            ["diagnostics"] = new { retainedWorkRoot = (string?)null },
            ["error"] = (string?)null
        });
    }

    private static string Hash(byte[] bytes) =>
        Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

    private static (string Sandbox, string RunDirectory, string ScriptPath) CreateSandbox()
    {
        var root = ToolchainTestHost.FindRepoRoot();
        var sandbox = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-ArchiveScript", Guid.NewGuid().ToString("N"));
        var runDirectory = Path.Combine(sandbox, "正式交付", "run-a");
        var output = Path.Combine(runDirectory, "run-a");
        var review = Path.Combine(runDirectory, "run-a.review");
        Directory.CreateDirectory(review);
        File.WriteAllText(Path.Combine(runDirectory, "file-1.md"), "answer markdown");
        File.WriteAllText(Path.Combine(runDirectory, "file-2.json"), "{\"ok\":true}");
        Directory.CreateDirectory(Path.Combine(runDirectory, "sub"));
        File.WriteAllText(Path.Combine(runDirectory, "sub", "page.pdf"), "%PDF-nested");
        File.WriteAllText(output + ".md", "answer markdown");
        File.WriteAllText(output + ".pdf", "%PDF-page");
        File.WriteAllText(output + ".snapshot.json", "{}");
        WriteWorkflowReceipt(Path.Combine(runDirectory, "run-a.workflow-run.json"), "succeeded");
        var sibling = Path.Combine(sandbox, "正式交付-fake", "run-b");
        Directory.CreateDirectory(sibling);
        File.WriteAllText(Path.Combine(sibling, "x.md"), "sibling");
        return (sandbox, runDirectory, Path.Combine(root, "scripts", "archive-delivery-run.ps1"));
    }

    private static async Task<ToolchainTestHost.ProcessResult> RunScriptAsync(string scriptPath, string repositoryRoot, string archiveRoot, string runDirectory)
        => await RunScriptCoreAsync(scriptPath, repositoryRoot, archiveRoot, runDirectory);

    private static async Task<ToolchainTestHost.ProcessResult> RunScriptWithoutArchiveRootAsync(string scriptPath, string repositoryRoot, string runDirectory)
        => await RunScriptCoreAsync(scriptPath, repositoryRoot, archiveRoot: null, runDirectory);

    private static async Task<ToolchainTestHost.ProcessResult> RunScriptCoreAsync(string scriptPath, string repositoryRoot, string? archiveRoot, string runDirectory)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = "pwsh",
            WorkingDirectory = Path.GetTempPath(),
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        startInfo.ArgumentList.Add("-NoProfile");
        // -NonInteractive: the missing-ArchiveRoot test omits a mandatory
        // parameter, which would otherwise open a prompt and hang until timeout.
        startInfo.ArgumentList.Add("-NonInteractive");
        startInfo.ArgumentList.Add("-ExecutionPolicy");
        startInfo.ArgumentList.Add("Bypass");
        startInfo.ArgumentList.Add("-File");
        startInfo.ArgumentList.Add(scriptPath);
        startInfo.ArgumentList.Add("-RepositoryRoot");
        startInfo.ArgumentList.Add(repositoryRoot);
        if (archiveRoot is not null)
        {
            startInfo.ArgumentList.Add("-ArchiveRoot");
            startInfo.ArgumentList.Add(archiveRoot);
        }
        startInfo.ArgumentList.Add("-RunDirectory");
        startInfo.ArgumentList.Add(runDirectory);

        using var process = Process.Start(startInfo) ?? throw new InvalidOperationException("Unable to start pwsh.");
        var stdoutTask = process.StandardOutput.ReadToEndAsync();
        var stderrTask = process.StandardError.ReadToEndAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(2));
        try
        {
            await process.WaitForExitAsync(timeout.Token);
        }
        catch (OperationCanceledException)
        {
            process.Kill(entireProcessTree: true);
            throw new TimeoutException("pwsh did not exit within two minutes.");
        }

        return new ToolchainTestHost.ProcessResult(process.ExitCode, (await stdoutTask) + Environment.NewLine + (await stderrTask));
    }

    private static void DeleteDirectory(string directory)
    {
        if (!Directory.Exists(directory))
        {
            return;
        }
        foreach (var file in Directory.EnumerateFiles(directory, "*", SearchOption.AllDirectories))
        {
            File.SetAttributes(file, FileAttributes.Normal);
        }
        Directory.Delete(directory, recursive: true);
    }
}
