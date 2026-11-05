using System.Diagnostics;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FluentAssertions;

namespace ClassroomToolkit.Tests.Toolchain;

[Trait("Gate", "ToolchainIntegration")]
public sealed class ToolchainCliBehaviorTests
{
    [Fact]
    public async Task TransferHelpersRespectWorkingDirectoryAndLiteralBackupNames()
    {
        var root = ToolchainTestHost.FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), $"transfer-helpers-{Guid.NewGuid():N}");
        Directory.CreateDirectory(testRoot);
        var prefix = Path.Combine(testRoot, "destination[1]");
        var oldBackup = Directory.CreateDirectory(prefix + ".backup.old").FullName;
        var newBackup = Directory.CreateDirectory(prefix + ".backup.new").FullName;
        var unrelated = Directory.CreateDirectory(Path.Combine(testRoot, "destination1.backup.unrelated")).FullName;
        Directory.SetLastWriteTimeUtc(oldBackup, DateTime.UtcNow.AddDays(-1));
        try
        {
            var script = $$"""
                $ErrorActionPreference = 'Stop'
                . '{{Path.Combine(root, "scripts", "transfer-common.ps1").Replace("'", "''")}}'
                $original = $PWD.Path
                Invoke-CheckedNative -FileName node -Arguments @('-p', 'process.cwd()') -WorkingDirectory '{{testRoot.Replace("'", "''")}}'
                if ($PWD.Path -ne $original) { throw 'Working directory was not restored' }
                try {
                    Invoke-CheckedNative -FileName node -Arguments @('-e', 'process.exit(23)') -WorkingDirectory '{{testRoot.Replace("'", "''")}}'
                    throw 'Expected native failure'
                } catch {
                    if ($_.Exception.Message -notmatch 'exit=23') { throw }
                }
                if ($PWD.Path -ne $original) { throw 'Failure did not restore working directory' }
                Remove-SupersededSiblingBackups -BasePath '{{prefix.Replace("'", "''")}}' -SuffixPrefix '.backup.' -Keep 1
                """;
            var result = await RunAsync("pwsh", root, "-NoProfile", "-Command", script);
            result.ExitCode.Should().Be(0, result.Output);
            result.Output.Should().Contain(testRoot);
            Directory.Exists(oldBackup).Should().BeFalse();
            Directory.Exists(newBackup).Should().BeTrue();
            Directory.Exists(unrelated).Should().BeTrue();
        }
        finally { Directory.Delete(testRoot, true); }
    }

    [Fact]
    public async Task LiveWorkflowRejectsAnActiveOutputLockBeforeDeletingReceipts()
    {
        var root = ToolchainTestHost.FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), $"workflow-lock-{Guid.NewGuid():N}");
        Directory.CreateDirectory(testRoot);
        var source = Path.Combine(testRoot, "exam.pdf");
        var prompt = Path.Combine(testRoot, "prompt.md");
        var env = Path.Combine(testRoot, "config.env");
        var receipt = Path.Combine(testRoot, "exam.workflow-run.json");
        File.WriteAllText(source, "%PDF-source");
        File.WriteAllText(prompt, "# prompt");
        File.WriteAllText(env, "CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=false");
        File.WriteAllText(receipt, "prior receipt");
        try
        {
            using var lease = new FileStream(Path.Combine(testRoot, ".exam.workflow.lock"), FileMode.Create, FileAccess.ReadWrite, FileShare.None);
            var result = await RunAsync("pwsh", root, "-NoProfile", "-File", "scripts/run-live-answer-workflow.ps1",
                "-SourcePdf", source, "-OutputDirectory", testRoot, "-PromptFile", prompt, "-ConfigEnvFile", env);
            result.ExitCode.Should().NotBe(0);
            result.Output.Should().Contain("output lock is unavailable");
            File.ReadAllText(receipt).Should().Be("prior receipt");
        }
        finally { Directory.Delete(testRoot, true); }
    }

    [Fact]
    public async Task LiveWorkflowProtectsInputsInsideTheDeliveryReviewDirectory()
    {
        var root = ToolchainTestHost.FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), $"workflow-directory-input-{Guid.NewGuid():N}");
        var review = Path.Combine(testRoot, "exam参考答案.review");
        Directory.CreateDirectory(review);
        var source = Path.Combine(review, "exam.pdf");
        var prompt = Path.Combine(testRoot, "prompt.md");
        var env = Path.Combine(testRoot, "config.env");
        File.WriteAllText(source, "%PDF-source");
        File.WriteAllText(prompt, "# prompt");
        File.WriteAllText(env, "CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=false");
        try
        {
            var result = await RunAsync("pwsh", root, "-NoProfile", "-File", "scripts/run-live-answer-workflow.ps1",
                "-SourcePdf", source, "-OutputDirectory", testRoot, "-PromptFile", prompt, "-ConfigEnvFile", env);
            result.ExitCode.Should().NotBe(0);
            result.Output.Should().Contain("collides with input SourcePdf");
            File.ReadAllText(source).Should().Be("%PDF-source");
        }
        finally { Directory.Delete(testRoot, true); }
    }

    [Fact]
    public async Task SnapshotCliProducesManifestAlignedArtifact()
    {
        var root = ToolchainTestHost.FindRepoRoot();
        var outputDirectory = Path.Combine(root, "tmp", "tests", "snapshot-cli", Guid.NewGuid().ToString("N"));
        var outputPath = Path.Combine(outputDirectory, "snapshot.json");
        Directory.CreateDirectory(outputDirectory);

        try
        {
            var result = await RunAsync(
                "node",
                root,
                "tools/rule-compiler/compile-snapshot.mjs",
                "--subject-pack", "junior-physics-answer",
                "--profile", "classroom",
                "--out", outputPath);

            result.ExitCode.Should().Be(0, result.Output);
            File.Exists(outputPath).Should().BeTrue();
            using var document = JsonDocument.Parse(File.ReadAllText(outputPath));
            var snapshot = document.RootElement;
            snapshot.GetProperty("snapshotId").GetString().Should().StartWith("snapshot-");
            snapshot.GetProperty("subjectPack").GetProperty("assetId").GetString().Should().Be("junior-physics-answer");
            // The aligned version is whatever the subject-pack manifest declares;
            // hardcoding it here would turn every spec version bump into a test edit.
            var manifestVersion = JsonDocument.Parse(
                File.ReadAllText(Path.Combine(root, "prompts", "junior-physics-answer", "manifest.json")))
                .RootElement.GetProperty("version").GetString();
            snapshot.GetProperty("subjectPack").GetProperty("version").GetString().Should().Be(manifestVersion);
            snapshot.GetProperty("activeProfile").GetProperty("name").GetString().Should().Be("classroom");
        }
        finally
        {
            if (Directory.Exists(outputDirectory)) Directory.Delete(outputDirectory, recursive: true);
        }
    }

    [Fact]
    public async Task TransferHelpersRejectLinkedFilesWithoutHashingTheirTargets()
    {
        var root = ToolchainTestHost.FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), $"transfer-reparse-{Guid.NewGuid():N}");
        var linkedTree = Path.Combine(testRoot, "linked-tree");
        var targetPath = Path.Combine(testRoot, "external");
        var linkedDirectory = Path.Combine(linkedTree, "external");
        Directory.CreateDirectory(linkedTree);
        Directory.CreateDirectory(targetPath);
        var externalFile = Path.Combine(targetPath, "must-not-read.txt");
        File.WriteAllText(externalFile, "external bytes");
        var createResult = await RunAsync(
            "cmd.exe",
            testRoot,
            "/d", "/c", "mklink", "/J", linkedDirectory, targetPath);
        if (createResult.ExitCode != 0)
        {
            return;
        }
        try
        {
            var script = """
                $ErrorActionPreference = 'Continue'
                . $env:TRANSFER_COMMON_PATH
                $ErrorActionPreference = 'Stop'
                Get-RelativeFileManifest -RootPath $env:LINKED_TREE_PATH | Out-Null
                throw 'manifest accepted linked file'
                """;
            var result = await RunAsyncWithEnvironment(
                "pwsh",
                root,
                new Dictionary<string, string?>
                {
                    ["TRANSFER_COMMON_PATH"] = Path.Combine(root, "scripts", "transfer-common.ps1"),
                    ["LINKED_TREE_PATH"] = linkedTree
                },
                "-NoProfile", "-Command", script);
            result.ExitCode.Should().NotBe(0, result.Output);
            result.NormalizedOutput.Should().Contain("reparse point");
            result.NormalizedOutput.Should().Contain("Transfer manifest tree");
            File.ReadAllText(externalFile).Should().Be("external bytes");
        }
        finally
        {
            if (Directory.Exists(linkedDirectory)) Directory.Delete(linkedDirectory);
            if (Directory.Exists(testRoot)) Directory.Delete(testRoot, recursive: true);
        }
    }

    [Fact]
    public async Task TransferManifestRejectsTraversingExclusions()
    {
        var root = ToolchainTestHost.FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), $"transfer-exclusion-{Guid.NewGuid():N}");
        var manifestRoot = Path.Combine(testRoot, "package");
        Directory.CreateDirectory(manifestRoot);
        File.WriteAllText(Path.Combine(manifestRoot, "payload.txt"), "payload");
        try
        {
            var script = """
                $ErrorActionPreference = 'Continue'
                . $env:TRANSFER_COMMON_PATH
                $ErrorActionPreference = 'Stop'
                Get-RelativeFileManifest `
                    -RootPath $env:LINKED_TREE_PATH `
                    -ExcludeRelativePaths @('../payload.txt') | Out-Null
                throw 'manifest accepted a traversing exclusion'
                """;
            var result = await RunAsyncWithEnvironment(
                "pwsh",
                root,
                new Dictionary<string, string?>
                {
                    ["TRANSFER_COMMON_PATH"] = Path.Combine(root, "scripts", "transfer-common.ps1"),
                    ["LINKED_TREE_PATH"] = manifestRoot
                },
                "-NoProfile", "-Command", script);
            result.ExitCode.Should().NotBe(0, result.Output);
            result.NormalizedOutput.Should().Contain("Invalid transfer manifest exclusion");
        }
        finally
        {
            if (Directory.Exists(testRoot)) Directory.Delete(testRoot, recursive: true);
        }
    }

    [Fact]
    public async Task SnapshotCliRejectsOutputOutsideTheRepository()
    {
        var root = ToolchainTestHost.FindRepoRoot();
        var outputPath = Path.Combine(Path.GetTempPath(), $"snapshot-outside-{Guid.NewGuid():N}.json");

        try
        {
            var result = await RunAsync(
                "node",
                root,
                "tools/rule-compiler/compile-snapshot.mjs",
                "--subject-pack", "junior-physics-answer",
                "--out", outputPath);

            result.ExitCode.Should().NotBe(0, result.Output);
            result.Output.Should().Contain("Snapshot output must remain inside the repository");
            File.Exists(outputPath).Should().BeFalse();
        }
        finally
        {
            if (File.Exists(outputPath)) File.Delete(outputPath);
        }
    }

    [Fact]
    public async Task ResumeReceiptFromBeforeEgressSwitchStillReusesBoundBlindCandidate()
    {
        var root = ToolchainTestHost.FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), $"workflow-resume-compat-{Guid.NewGuid():N}");
        var fakeNodeDirectory = Path.Combine(testRoot, "fake-node");
        var failedDirectory = Path.Combine(testRoot, "failed");
        var resumedDirectory = Path.Combine(testRoot, "resumed");
        var sourcePath = Path.Combine(testRoot, "exam.pdf");
        var referencePath = Path.Combine(testRoot, "exam-answers.pdf");
        var promptPath = Path.Combine(testRoot, "prompt.md");
        var envPath = Path.Combine(testRoot, ".env");
        var candidatePath = Path.Combine(failedDirectory, "exam盲答候选.md");
        var summaryPath = Path.Combine(failedDirectory, "exam.blind-generation.summary.json");
        var failedReceiptPath = Path.Combine(failedDirectory, "exam.workflow-run.json");
        Directory.CreateDirectory(fakeNodeDirectory);
        Directory.CreateDirectory(failedDirectory);
        File.WriteAllText(sourcePath, "%PDF-source");
        File.WriteAllText(referencePath, "%PDF-reference");
        File.WriteAllText(promptPath, "# prompt");
        File.WriteAllText(envPath, "CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=true");
        File.WriteAllText(candidatePath, "# 已完成的盲答\n");
        WriteMinimalBlindSummary(summaryPath, candidatePath);

        Dictionary<string, object> FileReceipt(string path)
        {
            var bytes = File.ReadAllBytes(path);
            return new Dictionary<string, object>
            {
                ["path"] = path,
                ["bytes"] = bytes.Length,
                ["sha256"] = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant()
            };
        }

        var priorReceipt = new Dictionary<string, object?>
        {
            ["kind"] = "live-answer-workflow-run",
            ["status"] = "failed",
            ["inputs"] = new Dictionary<string, object?>
            {
                ["sourcePdf"] = FileReceipt(sourcePath),
                ["referencePdf"] = FileReceipt(referencePath),
                ["prompt"] = FileReceipt(promptPath),
                ["blindFocusRegions"] = null,
                ["visualAuditFocusRegions"] = null,
                ["configEnv"] = FileReceipt(envPath)
            },
            ["options"] = new Dictionary<string, object?>
            {
                ["provider"] = "all",
                ["subjectPack"] = "junior-physics-answer",
                ["profile"] = "classroom",
                ["blindQualityProfile"] = "auto",
                ["semanticQualityProfile"] = "auto",
                ["visualQualityProfile"] = "auto",
                ["referenceQualityProfile"] = "auto",
                ["visualDetail"] = "original",
                ["maxOutputTokens"] = 24000,
                ["timeoutMs"] = 600000,
                ["reviewScale"] = 2.0,
                ["workflowReviewScale"] = 2.0,
                ["visualAuditScale"] = 4.0,
                ["blindFocusRegionsFile"] = null,
                ["visualAuditFocusRegionsFile"] = null,
                ["skipVisualAudit"] = true,
                ["keepReview"] = false,
                ["useGatewayProxy"] = false,
                ["configEnvFile"] = envPath
            },
            ["phases"] = new Dictionary<string, object>
            {
                ["blindGeneration"] = new Dictionary<string, object>
                {
                    ["status"] = "completed",
                    ["summary"] = FileReceipt(summaryPath),
                    ["artifact"] = FileReceipt(candidatePath)
                }
            }
        };
        File.WriteAllText(failedReceiptPath, JsonSerializer.Serialize(priorReceipt));
        WriteFakeNodeTool(fakeNodeDirectory, """
                "review-source-pdf.mjs" {
                    $out = Get-Option "--out"
                    $prefix = if ($out -like "*reference-pages*") {
                        "reference"
                    } elseif ($out -like "*visual-audit-pages*") {
                        "visual"
                    } else {
                        "source"
                    }
                    Write-Text (Join-Path $out "$prefix.page-1.png") "png"
                    Write-Text (Join-Path $out "manifest.json") '{"pages":[{}]}'
                    if ($env:CLASSROOM_TOOLKIT_TEST_MUTATE_VISUAL_CANDIDATE -eq "true") {
                        Write-Text (Join-Path $env:CLASSROOM_TOOLKIT_TEST_DELIVERY_ROOT "..\delivery\exam视觉审计候选.md") "# 参考复核前被篡改的候选`n"
                    }
                }
                "answer-request.mjs" {
                    $output = Get-Option "--output"
                    if ($output -like "*盲答候选.md") { throw "blind generation must not be called during resume" }
                    Write-Text $output "# 物理试卷参考答案`n"
                        $mode = if ($toolArgs -contains "--semantic-findings-only") {
                        "semantic_review_findings"
                        } elseif ($toolArgs -contains "--semantic-findings-file") {
                        "semantic_review_merge"
                    } elseif (Get-Option "--reference-images-dir") {
                        "reference_review"
                    } else {
                        "blind_generation"
                    }
                    Write-SuccessSummary (Get-Option "--summary-out") $mode $output
                }
                "answer-diff-report.mjs" { Write-Text $toolArgs[2] "# diff`n" }
                "deliver-answer.mjs" {
                    $pdf = [IO.Path]::GetFullPath($toolArgs[1])
                    $base = Join-Path ([IO.Path]::GetDirectoryName($pdf)) ([IO.Path]::GetFileNameWithoutExtension($pdf))
                    $input = $toolArgs[0]
                    $review = $base + ".review"
                    Write-Text (Join-Path $review "page-001.png") "png"
                    Write-Text (Join-Path $review "manifest.json") '{"kind":"pdf-source-review","pageCount":1,"selectedPages":[1],"pages":[]}'
                    Write-Text $pdf "%PDF-delivery"
                    Write-Text ($base + ".snapshot.json") '{"snapshotId":"test"}'
                    Write-Text ($base + ".delivery-manifest.json") '{"kind":"delivery-manifest"}'
                }
                """);

        try
        {
            var result = await RunAsyncWithEnvironment(
                "pwsh",
                root,
                new Dictionary<string, string?> { ["PATH"] = fakeNodeDirectory + Path.PathSeparator + Environment.GetEnvironmentVariable("PATH") },
                "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-File", "scripts/run-live-answer-workflow.ps1",
                "-SourcePdf", sourcePath,
                "-ReferencePdf", referencePath,
                "-OutputDirectory", resumedDirectory,
                "-PromptFile", promptPath,
                "-ConfigEnvFile", envPath,
                "-ResumeFromWorkflowReceipt", failedReceiptPath,
                "-SkipVisualAudit",
                "-AllowCloudEgress");

            result.ExitCode.Should().Be(0, result.Output);
            using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(resumedDirectory, "exam.workflow-run.json")));
            var receipt = document.RootElement;
            receipt.GetProperty("status").GetString().Should().Be("succeeded");
            receipt.GetProperty("phases").GetProperty("blindGeneration").GetProperty("artifact").GetProperty("sha256").GetString()
                .Should().Be(FileReceipt(candidatePath)["sha256"].ToString());
            receipt.GetProperty("resume").GetProperty("workflowReceipt").GetProperty("sha256").GetString()
                .Should().Be(FileReceipt(failedReceiptPath)["sha256"].ToString());
            // The copied summary must be rewritten to point at this run's
            // artifact: a verbatim copy still carries the prior directory's
            // outputPath and would fail the real receipt validator's
            // summary.outputPath === phase.artifact.path rule. The fake node
            // stubs that validator, so assert the rewrite directly.
            using var resumedSummary = JsonDocument.Parse(File.ReadAllText(Path.Combine(resumedDirectory, "exam.blind-generation.summary.json")));
            resumedSummary.RootElement.GetProperty("outputPath").GetString()
                .Should().Be(Path.Combine(resumedDirectory, "exam盲答候选.md"));
        }
        finally
        {
            if (Directory.Exists(testRoot)) Directory.Delete(testRoot, recursive: true);
        }
    }

    [Fact]
    public async Task SnapshotCliRejectsUnknownSubjectPack()
    {
        var result = await RunAsync(
            "node",
            ToolchainTestHost.FindRepoRoot(),
            "tools/rule-compiler/compile-snapshot.mjs",
            "--subject-pack", "missing-subject-pack",
            "--profile", "classroom");

        result.ExitCode.Should().NotBe(0);
        result.Output.Should().Contain("missing-subject-pack");
    }

    [Fact]
    public async Task PublishedSmokeFailsClosedWhenExecutableIsMissing()
    {
        var missingPublishDirectory = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-MissingPublish", Guid.NewGuid().ToString("N"));
        var result = await RunAsync(
            "pwsh",
            ToolchainTestHost.FindRepoRoot(),
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", "scripts/smoke-installed-app.ps1",
            "-PublishDir", missingPublishDirectory);

        result.ExitCode.Should().NotBe(0);
        result.Output.Should().Contain("Published app not found");
    }

    [Fact]
    public async Task InstallReleaseRejectsLoopbackManifestWithoutSimulationSwitch()
    {
        var root = ToolchainTestHost.FindRepoRoot();
        var manifestUrl = "http://127.0.0.1:43210/update-manifest.json";

        var rejected = await RunAsync(
            "pwsh",
            root,
            "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/install-release.ps1",
            "-ManifestUrl", manifestUrl);

        rejected.ExitCode.Should().NotBe(0);
        rejected.Output.Should().Contain("approved GitHub HTTPS host");
    }

    [Fact]
    public async Task PackageReleaseRejectsVersionThatDoesNotMatchSourceProject()
    {
        var result = await RunAsync(
            "pwsh",
            ToolchainTestHost.FindRepoRoot(),
            "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/package-release.ps1",
            "-Version", "9.9.9",
            "-SkipPublish");

        result.ExitCode.Should().NotBe(0);
        result.Output.Should().Contain("does not match the source project version");
    }

    [Fact]
    public async Task PackageReleaseDoesNotRequireCodeSigningSecrets()
    {
        var result = await RunAsync(
            "pwsh",
            ToolchainTestHost.FindRepoRoot(),
            "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/package-release.ps1",
            "-Version", "1.0.6",
            "-SkipPublish",
            "-IsccPath", Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"), "missing-ISCC.exe"));

        result.ExitCode.Should().NotBe(0);
        result.Output.Should().NotContain("code-signing certificate");
        (result.Output.Contains("Inno Setup compiler was not found", StringComparison.Ordinal)
            || result.Output.Contains("Ordinary-user packaging requires a clean working tree.", StringComparison.Ordinal))
            .Should().BeTrue(result.Output);
    }

    [Fact]
    public void ReleaseWorkflowAllowsRetryableCandidatesBeforeTaggedPublication()
    {
        var workflow = File.ReadAllText(Path.Combine(ToolchainTestHost.FindRepoRoot(), ".github", "workflows", "release.yml"));

        workflow.Should().Contain("setup-development.ps1 -NoInstall -SkipHealthEval");
        workflow.Should().NotContain("setup-development.ps1 -NoInstall -SkipCore");
        // AGENTS.md routes release changes through -Mode Full (cross-subject,
        // delivery contract and every subject-pack eval); candidate retries
        // must pass that gate before any stable version tag is created.
        workflow.Should().Contain("check-toolchain.ps1 -Mode Full");
        workflow.Should().NotContain("  push:\n    tags:");
        workflow.Should().Contain("- build-candidate");
        workflow.Should().Contain("- publish-accepted-candidate");
        workflow.Should().Contain("if: github.event_name == 'workflow_dispatch' && inputs.action == 'build-candidate'");
        workflow.Should().Contain("if: github.event_name == 'workflow_dispatch' && inputs.action == 'publish-accepted-candidate'");
        workflow.Should().Contain("Candidate builds must run from the main branch.");
        workflow.Should().Contain("git ls-remote --refs origin \"refs/tags/v$version\"");
        workflow.Should().Contain("Release tag v$version already exists; choose the next unused version.");
        workflow.Should().Contain("release-candidate-");
        workflow.Should().Contain("verify-release-acceptance.ps1");
        workflow.Should().Contain("Build unsigned stable release candidate");
        workflow.Should().NotContain("WINDOWS_SIGNING_CERTIFICATE");
        workflow.Should().Contain("[string]$run.event -ne \"workflow_dispatch\"");
        workflow.Should().Contain("[string]$run.head_branch -ne \"main\"");
        workflow.Should().Contain("candidate-completed-at=$($run.updated_at)");
        workflow.Should().NotContain("candidate-created-at=");
        workflow.Should().Contain("gh release create");
        workflow.Split("publish-accepted-candidate:", StringSplitOptions.None)[0]
            .Should().NotContain("gh release create");
        workflow.IndexOf("verify-release-acceptance.ps1", StringComparison.Ordinal)
            .Should().BeLessThan(workflow.IndexOf("gh release create", StringComparison.Ordinal));

        var packageAcceptance = File.ReadAllText(Path.Combine(ToolchainTestHost.FindRepoRoot(), "scripts", "test-ordinary-user-package.ps1"));
        packageAcceptance.Should().Contain("Invoke-RendererSmoke -Root $installRoot -Distribution \"installer\"");
        packageAcceptance.Should().Contain("Invoke-RendererSmoke -Root $portableRoot -Distribution \"portable\"");
        packageAcceptance.Should().Contain("integrity.output.sha256");
        packageAcceptance.Should().Contain("representative human acceptance");
        packageAcceptance.Should().Contain("合力满足 $F=ma$。");

        var releaseMetadata = File.ReadAllText(Path.Combine(ToolchainTestHost.FindRepoRoot(), "scripts", "write-release-metadata.ps1"));
        releaseMetadata.Should().Contain("_release-metadata/representative-acceptance.json");
        releaseMetadata.Should().Contain("Representative acceptance does not bind the current");
        releaseMetadata.Should().Contain("Install manifest Authenticode status does not match");
        releaseMetadata.Should().Contain("Update manifest publisherThumbprint does not match");
        releaseMetadata.Should().Contain("Update manifest does not bind the current installer URL, byte count and SHA-256");

        var packageBuilder = File.ReadAllText(Path.Combine(ToolchainTestHost.FindRepoRoot(), "scripts", "build-ordinary-user-package.ps1"));
        packageBuilder.Should().Contain("SignatureStatus]::NotSigned");
        packageBuilder.Should().Contain("Compatibility alias; unsigned packages are now the default.");
    }

    [Fact]
    public async Task ReleaseAcceptanceBindsExactCandidateRunAndPackageHashes()
    {
        var root = ToolchainTestHost.FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-ReleaseAcceptance", Guid.NewGuid().ToString("N"));
        var deliveryRoot = Path.Combine(testRoot, "delivery");
        var installerPath = Path.Combine(deliveryRoot, "installer", "stable", "ClassroomToolkit-1.0.5-setup.exe");
        var portablePath = Path.Combine(deliveryRoot, "portable", "ClassroomToolkit-1.0.5-portable-win-x64.zip");
        var installManifestPath = Path.Combine(deliveryRoot, "installer", "stable", "install-manifest.json");
        var acceptanceInputPath = Path.Combine(testRoot, "acceptance-input.json");
        var sourceCommit = new string('a', 40);
        const string candidateRunId = "123456789";
        var candidateCreatedAt = DateTimeOffset.UtcNow.AddMinutes(-5);
        var candidateCompletedAt = DateTimeOffset.UtcNow.AddMinutes(-3);
        var acceptedAt = DateTimeOffset.UtcNow.AddMinutes(-1);
        Directory.CreateDirectory(Path.GetDirectoryName(installerPath)!);
        Directory.CreateDirectory(Path.GetDirectoryName(portablePath)!);
        File.WriteAllBytes(installerPath, Encoding.UTF8.GetBytes("signed installer package fixture"));
        File.WriteAllBytes(portablePath, Encoding.UTF8.GetBytes("portable package fixture"));
        var installerHash = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(installerPath))).ToLowerInvariant();
        var portableHash = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(portablePath))).ToLowerInvariant();
        File.WriteAllText(installManifestPath, JsonSerializer.Serialize(new
        {
            schemaVersion = "1.0",
            kind = "classroom-toolkit-install-manifest",
            version = "1.0.5",
            sourceCommit,
            assets = new[]
            {
                new { kind = "installer", name = Path.GetFileName(installerPath), sha256 = installerHash, bytes = new FileInfo(installerPath).Length },
                new { kind = "portable", name = Path.GetFileName(portablePath), sha256 = portableHash, bytes = new FileInfo(portablePath).Length }
            }
        }));

        try
        {
            var acceptanceRecord = new
            {
                schemaVersion = "1.0",
                kind = "classroom-toolkit-representative-acceptance-input",
                status = "accepted",
                version = "1.0.5",
                sourceCommit,
                candidateRunId,
                acceptedAt = acceptedAt.ToString("O"),
                tester = new { identifier = "teacher-test-01", role = "representative-non-developer" },
                confirmedByReleaseOwner = "release-owner",
                acknowledgement = "I confirm the representative tester performed the recorded real-world checks on these exact package hashes.",
                evidenceReference = "manual-test/teacher-2026-11-04.json",
                assets = new { installerSha256 = installerHash, portableSha256 = portableHash },
                scenarios = new
                {
                    installerCleanInstall = "passed",
                    installerRepair = "passed",
                    installerMarkdownPdfDelivery = "passed",
                    portableLaunch = "passed",
                    portableMarkdownPdfDelivery = "passed"
                }
            };
            File.WriteAllText(acceptanceInputPath, JsonSerializer.Serialize(acceptanceRecord));

            var accepted = await RunAsync(
                "pwsh", root,
                "-NoProfile", "-ExecutionPolicy", "Bypass",
                "-File", "scripts/verify-release-acceptance.ps1",
                "-Version", "1.0.5",
                "-SourceCommit", sourceCommit,
                "-CandidateRunId", candidateRunId,
                "-GitHubActor", "release-owner",
                "-CandidateCompletedAt", candidateCompletedAt.ToString("O"),
                "-AcceptanceRecordPath", acceptanceInputPath,
                "-DeliveryRoot", deliveryRoot);

            accepted.ExitCode.Should().Be(0, accepted.Output);
            var verifiedRecordPath = Path.Combine(deliveryRoot, "_release-metadata", "representative-acceptance.json");
            using (var document = JsonDocument.Parse(File.ReadAllText(verifiedRecordPath)))
            {
                var verified = document.RootElement;
                verified.GetProperty("candidateRunId").GetString().Should().Be(candidateRunId);
                verified.GetProperty("submittedByGitHubActor").GetString().Should().Be("release-owner");
                verified.GetProperty("assets").EnumerateArray()
                    .Single(asset => asset.GetProperty("kind").GetString() == "installer")
                    .GetProperty("sha256").GetString().Should().Be(installerHash);
                verified.GetProperty("assets").EnumerateArray()
                    .Single(asset => asset.GetProperty("kind").GetString() == "portable")
                    .GetProperty("sha256").GetString().Should().Be(portableHash);
            }
            var unconfirmedInput = System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(acceptanceInputPath))!;
            unconfirmedInput["confirmedByReleaseOwner"] = "different-owner";
            File.WriteAllText(acceptanceInputPath, unconfirmedInput.ToJsonString());
            var unconfirmed = await RunAsync(
                "pwsh", root,
                "-NoProfile", "-ExecutionPolicy", "Bypass",
                "-File", "scripts/verify-release-acceptance.ps1",
                "-Version", "1.0.5",
                "-SourceCommit", sourceCommit,
                "-CandidateRunId", candidateRunId,
                "-GitHubActor", "release-owner",
                "-CandidateCompletedAt", candidateCompletedAt.ToString("O"),
                "-AcceptanceRecordPath", acceptanceInputPath,
                "-DeliveryRoot", deliveryRoot);
            unconfirmed.ExitCode.Should().NotBe(0);
            unconfirmed.Output.Should().Contain("explicitly confirmed");
            unconfirmedInput["confirmedByReleaseOwner"] = "release-owner";
            File.WriteAllText(acceptanceInputPath, unconfirmedInput.ToJsonString());

            var earlyAcceptanceJson = System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(acceptanceInputPath))!;
            earlyAcceptanceJson["acceptedAt"] = candidateCreatedAt.AddMinutes(1).ToString("O");
            File.WriteAllText(acceptanceInputPath, earlyAcceptanceJson.ToJsonString());
            var acceptedBeforeCandidateCompleted = await RunAsync(
                "pwsh", root,
                "-NoProfile", "-ExecutionPolicy", "Bypass",
                "-File", "scripts/verify-release-acceptance.ps1",
                "-Version", "1.0.5",
                "-SourceCommit", sourceCommit,
                "-CandidateRunId", candidateRunId,
                "-GitHubActor", "release-owner",
                "-CandidateCompletedAt", candidateCompletedAt.ToString("O"),
                "-AcceptanceRecordPath", acceptanceInputPath,
                "-DeliveryRoot", deliveryRoot);

            acceptedBeforeCandidateCompleted.ExitCode.Should().NotBe(0);
            acceptedBeforeCandidateCompleted.Output.Should().Contain("acceptance must occur after the candidate completed");

            File.WriteAllText(acceptanceInputPath, JsonSerializer.Serialize(new
            {
                schemaVersion = "1.0",
                kind = "classroom-toolkit-representative-acceptance-input",
                status = "accepted",
                version = "1.0.5",
                sourceCommit,
                candidateRunId,
                acceptedAt = acceptedAt.ToString("O"),
                tester = new { identifier = "teacher-test-01", role = "representative-non-developer" },
                confirmedByReleaseOwner = "release-owner",
                acknowledgement = "I confirm the representative tester performed the recorded real-world checks on these exact package hashes.",
                evidenceReference = "manual-test/teacher-2026-11-04.json",
                assets = new { installerSha256 = installerHash, portableSha256 = new string('0', 64) },
                scenarios = new
                {
                    installerCleanInstall = "passed",
                    installerRepair = "passed",
                    installerMarkdownPdfDelivery = "passed",
                    portableLaunch = "passed",
                    portableMarkdownPdfDelivery = "passed"
                }
            }));
            var mismatched = await RunAsync(
                "pwsh", root,
                "-NoProfile", "-ExecutionPolicy", "Bypass",
                "-File", "scripts/verify-release-acceptance.ps1",
                "-Version", "1.0.5",
                "-SourceCommit", sourceCommit,
                "-CandidateRunId", candidateRunId,
                "-GitHubActor", "release-owner",
                "-CandidateCompletedAt", candidateCompletedAt.ToString("O"),
                "-AcceptanceRecordPath", acceptanceInputPath,
                "-DeliveryRoot", deliveryRoot);

            mismatched.ExitCode.Should().NotBe(0);
            mismatched.Output.Should().Contain("portable hash does not match");
        }
        finally
        {
            if (Directory.Exists(testRoot)) Directory.Delete(testRoot, recursive: true);
        }
    }

    [Fact]
    public async Task ReleaseMetadataAcceptsUnsignedInstallerAndBindsUpdateManifestToItsHash()
    {
        var root = ToolchainTestHost.FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), $"ClassroomToolkit-UnsignedRelease-{Guid.NewGuid():N}");
        var deliveryRoot = Path.Combine(testRoot, "delivery");
        var installerPath = Path.Combine(deliveryRoot, "installer", "stable", "ClassroomToolkit-1.0.4-setup.exe");
        var portablePath = Path.Combine(deliveryRoot, "portable", "ClassroomToolkit-1.0.4-portable-win-x64.zip");
        var sourcePath = Path.Combine(deliveryRoot, "source", "ClassroomToolkit-1.0.4-source.zip");
        var installManifestPath = Path.Combine(deliveryRoot, "installer", "stable", "install-manifest.json");
        var updateManifestPath = Path.Combine(deliveryRoot, "installer", "stable", "update-manifest.json");
        var sbomPath = Path.Combine(deliveryRoot, "_release-metadata", "sbom", "spdx_2.2", "manifest.spdx.json");
        var acceptancePath = Path.Combine(deliveryRoot, "_release-metadata", "representative-acceptance.json");
        const string sourceCommit = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

        Directory.CreateDirectory(Path.GetDirectoryName(installerPath)!);
        Directory.CreateDirectory(Path.GetDirectoryName(portablePath)!);
        Directory.CreateDirectory(Path.GetDirectoryName(sourcePath)!);
        Directory.CreateDirectory(Path.GetDirectoryName(sbomPath)!);
        File.Copy(Path.Combine(root, "src", "ClassroomToolkit.App", "bin", "Debug", "net10.0-windows", "ClassroomToolkit.App.exe"), installerPath);
        File.WriteAllText(portablePath, "portable fixture");
        File.WriteAllText(sourcePath, "source fixture");
        File.WriteAllText(sbomPath, "{}");

        static string Sha256(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant();
        var installerHash = Sha256(installerPath);
        var portableHash = Sha256(portablePath);
        var sourceHash = Sha256(sourcePath);
        var installerName = Path.GetFileName(installerPath);
        var portableName = Path.GetFileName(portablePath);
        var sourceName = Path.GetFileName(sourcePath);
        var installerBytes = new FileInfo(installerPath).Length;
        var portableBytes = new FileInfo(portablePath).Length;
        var sourceBytes = new FileInfo(sourcePath).Length;

        File.WriteAllText(installManifestPath, JsonSerializer.Serialize(new
        {
            schemaVersion = "1.0",
            kind = "classroom-toolkit-install-manifest",
            version = "1.0.4",
            sourceCommit,
            workspaceContract = "2",
            publisherSignature = new { status = "NotSigned", signerSubject = (string?)null, signerThumbprint = (string?)null },
            assets = new[]
            {
                new { kind = "installer", name = installerName, sha256 = installerHash, bytes = installerBytes },
                new { kind = "portable", name = portableName, sha256 = portableHash, bytes = portableBytes },
                new { kind = "source", name = sourceName, sha256 = sourceHash, bytes = sourceBytes }
            }
        }));
        File.WriteAllText(updateManifestPath, JsonSerializer.Serialize(new
        {
            schemaVersion = "2.0",
            kind = "classroom-toolkit-update-manifest",
            version = "1.0.4",
            workspaceContract = "2",
            sourceCommit,
            publisherThumbprint = (string?)null,
            assets = new[]
            {
                new
                {
                    kind = "installer",
                    name = installerName,
                    url = $"https://github.com/sciman-top/classroom-answer-toolkit/releases/download/v1.0.4/{installerName}",
                    sha256 = installerHash,
                    bytes = installerBytes
                }
            }
        }));
        File.WriteAllText(acceptancePath, JsonSerializer.Serialize(new
        {
            schemaVersion = "1.0",
            kind = "classroom-toolkit-representative-acceptance",
            status = "accepted",
            version = "1.0.4",
            sourceCommit,
            candidateRunId = "123456789",
            submittedByGitHubActor = "release-owner",
            tester = new { identifier = "teacher-test-01", role = "representative-non-developer" },
            releaseOwnerConfirmation = new
            {
                confirmedByGitHubActor = "release-owner",
                acknowledgement = "I confirm the representative tester performed the recorded real-world checks on these exact package hashes."
            },
            assets = new[]
            {
                new { kind = "installer", path = "installer/stable/ClassroomToolkit-1.0.4-setup.exe", bytes = installerBytes, sha256 = installerHash },
                new { kind = "portable", path = "portable/ClassroomToolkit-1.0.4-portable-win-x64.zip", bytes = portableBytes, sha256 = portableHash }
            },
            scenarios = new
            {
                installerCleanInstall = "passed",
                installerRepair = "passed",
                installerMarkdownPdfDelivery = "passed",
                portableLaunch = "passed",
                portableMarkdownPdfDelivery = "passed"
            }
        }));

        try
        {
            var accepted = await RunAsync(
                "pwsh", root,
                "-NoProfile", "-ExecutionPolicy", "Bypass",
                "-File", "scripts/write-release-metadata.ps1",
                "-Version", "1.0.4",
                "-SourceCommit", sourceCommit,
                "-DeliveryRoot", deliveryRoot);

            accepted.ExitCode.Should().Be(0, accepted.Output);
            File.Exists(Path.Combine(deliveryRoot, "_release-metadata", "release-manifest.json")).Should().BeTrue();
            File.ReadAllText(Path.Combine(deliveryRoot, "_release-metadata", "checksums.sha256"))
                .Should().Contain(installerHash)
                .And.Contain("installer/stable/ClassroomToolkit-1.0.4-setup.exe");

            using var updateManifest = JsonDocument.Parse(File.ReadAllText(updateManifestPath));
            updateManifest.RootElement.GetProperty("publisherThumbprint").ValueKind.Should().Be(JsonValueKind.Null);
        }
        finally
        {
            if (Directory.Exists(testRoot)) Directory.Delete(testRoot, recursive: true);
        }
    }

    [Fact]
    public async Task ArtifactCleanupKeepsCurrentDeliveryAndHistoryButRemovesWorkAndOldVersions()
    {
        var root = ToolchainTestHost.FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-ArtifactLayout", Guid.NewGuid().ToString("N"));
        var artifactsRoot = Path.Combine(testRoot, "artifacts");
        var currentDelivery = Path.Combine(artifactsRoot, "deliveries", "1.0.1");
        var oldDelivery = Path.Combine(artifactsRoot, "deliveries", "1.0.0");
        var history = Path.Combine(artifactsRoot, "history", "diagnostics", "20260827");
        var work = Path.Combine(artifactsRoot, "work", "publish");

        try
        {
            Directory.CreateDirectory(currentDelivery);
            Directory.CreateDirectory(oldDelivery);
            Directory.CreateDirectory(Path.Combine(currentDelivery, "source"));
            Directory.CreateDirectory(Path.Combine(oldDelivery, "source"));
            Directory.CreateDirectory(history);
            Directory.CreateDirectory(work);
            File.WriteAllText(Path.Combine(currentDelivery, "source", "ClassroomToolkit-1.0.1-source.zip"), "current");
            File.WriteAllText(Path.Combine(oldDelivery, "source", "ClassroomToolkit-1.0.0-source.zip"), "old");
            File.WriteAllText(Path.Combine(history, "receipt.json"), "history");
            File.WriteAllText(Path.Combine(work, "marker.txt"), "work");

            var result = await RunAsync(
                "pwsh",
                root,
                "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/clean-artifacts.ps1",
                "-ArtifactsRoot", artifactsRoot,
                "-KeepVersion", "1.0.1");

            result.ExitCode.Should().Be(0, result.Output);
            Directory.Exists(currentDelivery).Should().BeTrue();
            Directory.Exists(oldDelivery).Should().BeFalse();
            Directory.Exists(work).Should().BeFalse();
            File.Exists(Path.Combine(history, "receipt.json")).Should().BeTrue();
        }
        finally
        {
            if (Directory.Exists(testRoot)) Directory.Delete(testRoot, recursive: true);
        }
    }

    [Fact]
    public async Task ImportTransferPreservesExistingEnvWhenPackageDoesNotContainOne()
    {
        var root = ToolchainTestHost.FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-PreserveEnv", Guid.NewGuid().ToString("N"));
        var packagePath = Path.Combine(testRoot, "transfer.zip");
        var destination = Path.Combine(testRoot, "destination");

        try
        {
            CreateTransferPackage(
                packagePath,
                new Dictionary<string, string> { ["workspace/readme.txt"] = "incoming" },
                "workspace/readme.txt");
            Directory.CreateDirectory(Path.Combine(destination, "workspace"));
            File.WriteAllText(Path.Combine(destination, "workspace", ".env"), "AUDIT_KEY=preserve-me");

            var result = await RunAsync(
                "pwsh",
                root,
                "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/import-transfer.ps1",
                "-Package", packagePath,
                "-Destination", destination,
                "-AllowExistingDestination",
                "-PreserveExistingEnv");

            result.ExitCode.Should().Be(0, result.Output);
            File.ReadAllText(Path.Combine(destination, "workspace", ".env")).Should().Be("AUDIT_KEY=preserve-me");
        }
        finally
        {
            if (Directory.Exists(testRoot)) Directory.Delete(testRoot, recursive: true);
        }
    }

    [Fact]
    public async Task ImportTransferRestoresExistingDestinationWhenSetupFails()
    {
        var root = ToolchainTestHost.FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-Rollback", Guid.NewGuid().ToString("N"));
        var packagePath = Path.Combine(testRoot, "transfer.zip");
        var destination = Path.Combine(testRoot, "destination");

        try
        {
            CreateTransferPackage(
                packagePath,
                new Dictionary<string, string>
                {
                    ["workspace/scripts/setup-development.ps1"] = "exit 23",
                    ["workspace/new-marker.txt"] = "new"
                },
                "workspace/scripts/setup-development.ps1",
                "workspace/new-marker.txt");
            Directory.CreateDirectory(Path.Combine(destination, "workspace"));
            File.WriteAllText(Path.Combine(destination, "workspace", "old-marker.txt"), "old");

            var result = await RunAsync(
                "pwsh",
                root,
                "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/import-transfer.ps1",
                "-Package", packagePath,
                "-Destination", destination,
                "-AllowExistingDestination",
                "-RunSetup");

            result.ExitCode.Should().NotBe(0);
            File.Exists(Path.Combine(destination, "workspace", "old-marker.txt")).Should().BeTrue();
            File.Exists(Path.Combine(destination, "workspace", "new-marker.txt")).Should().BeFalse();
            Directory.GetDirectories(testRoot, "destination.failed.*").Should().ContainSingle();
        }
        finally
        {
            if (Directory.Exists(testRoot)) Directory.Delete(testRoot, recursive: true);
        }
    }

    [Fact]
    public async Task ImportTransferRejectsFilesNotDeclaredByManifest()
    {
        var root = ToolchainTestHost.FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-ExtraFile", Guid.NewGuid().ToString("N"));
        var packagePath = Path.Combine(testRoot, "transfer.zip");
        var destination = Path.Combine(testRoot, "destination");

        try
        {
            CreateTransferPackage(
                packagePath,
                new Dictionary<string, string>
                {
                    ["workspace/readme.txt"] = "declared",
                    ["workspace/Directory.Build.targets"] = "unlisted"
                },
                "workspace/readme.txt");

            var result = await RunAsync(
                "pwsh",
                root,
                "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/import-transfer.ps1",
                "-Package", packagePath,
                "-Destination", destination);

            result.ExitCode.Should().NotBe(0);
            result.Output.Should().Contain("manifest file set mismatch");
            Directory.Exists(destination).Should().BeFalse();
        }
        finally
        {
            if (Directory.Exists(testRoot)) Directory.Delete(testRoot, recursive: true);
        }
    }

    [Fact]
    public async Task LiveWorkflowRejectsReferencePdfOutputCollisionBeforeRunningTools()
    {
        var root = ToolchainTestHost.FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-WorkflowCollision", Guid.NewGuid().ToString("N"));
        var outputDirectory = Path.Combine(testRoot, "delivery");
        var sourcePath = Path.Combine(testRoot, "exam.pdf");
        var referencePath = Path.Combine(outputDirectory, "exam参考答案.pdf");
        var promptPath = Path.Combine(testRoot, "prompt.md");
        var envPath = Path.Combine(testRoot, ".env");
        Directory.CreateDirectory(outputDirectory);
        File.WriteAllText(sourcePath, "%PDF-source");
        File.WriteAllText(referencePath, "%PDF-authority");
        File.WriteAllText(promptPath, "# prompt");
        File.WriteAllText(envPath, "CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=true");

        try
        {
            var result = await RunAsync(
                "pwsh",
                root,
                "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-File", "scripts/run-live-answer-workflow.ps1",
                "-SourcePdf", sourcePath,
                "-ReferencePdf", referencePath,
                "-OutputDirectory", outputDirectory,
                "-PromptFile", promptPath,
                "-ConfigEnvFile", envPath);

            result.ExitCode.Should().NotBe(0);
            result.Output.Should().Contain("collides with input ReferencePdf");
            File.ReadAllText(referencePath).Should().Be("%PDF-authority");
        }
        finally
        {
            if (Directory.Exists(testRoot)) Directory.Delete(testRoot, recursive: true);
        }
    }

    [Theory]
    [InlineData(false, true, "explicit -AllowCloudEgress")]
    [InlineData(true, false, "CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=true")]
    public async Task LiveWorkflowRequiresBothCloudEgressPermissionsBeforeCallingAI(
        bool allowCloudEgress,
        bool configAllowsEgress,
        string expectedError)
    {
        var root = ToolchainTestHost.FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), $"workflow-egress-{Guid.NewGuid():N}");
        var fakeNodeDirectory = Path.Combine(testRoot, "fake-node");
        var outputDirectory = Path.Combine(testRoot, "delivery");
        var answerCallMarker = Path.Combine(testRoot, "answer-called.txt");
        var sourcePath = Path.Combine(testRoot, "exam.pdf");
        var referencePath = Path.Combine(testRoot, "exam-answers.pdf");
        var promptPath = Path.Combine(testRoot, "prompt.md");
        var envPath = Path.Combine(testRoot, ".env");
        Directory.CreateDirectory(fakeNodeDirectory);
        File.WriteAllText(sourcePath, "%PDF-source");
        File.WriteAllText(referencePath, "%PDF-reference");
        File.WriteAllText(promptPath, "# prompt");
        File.WriteAllText(envPath, configAllowsEgress
            ? "CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=true"
            : "CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=false");
        WriteFakeNodeTool(fakeNodeDirectory, """
                "review-source-pdf.mjs" {
                    $out = Get-Option "--out"
                    Write-Text (Join-Path $out "exam.page-1.png") "png"
                    Write-Text (Join-Path $out "manifest.json") '{"pages":[{}]}'
                }
                "answer-request.mjs" { throw "AI request must not run" }
                """);

        try
        {
            var arguments = new List<string>
            {
                "-NoProfile", "-ExecutionPolicy", "Bypass",
                "-File", "scripts/run-live-answer-workflow.ps1",
                "-SourcePdf", sourcePath,
                "-ReferencePdf", referencePath,
                "-OutputDirectory", outputDirectory,
                "-PromptFile", promptPath,
                "-ConfigEnvFile", envPath,
                "-SkipVisualAudit"
            };
            if (allowCloudEgress)
            {
                arguments.Add("-AllowCloudEgress");
            }

            var result = await RunAsyncWithEnvironment(
                "pwsh",
                root,
                new Dictionary<string, string?> { ["PATH"] = fakeNodeDirectory + Path.PathSeparator + Environment.GetEnvironmentVariable("PATH") },
                arguments.ToArray());

            result.ExitCode.Should().NotBe(0, result.Output);
            result.Output.Should().Contain(expectedError);
            File.Exists(answerCallMarker).Should().BeFalse("the AI request must fail closed before provider dispatch");
        }
        finally
        {
            if (Directory.Exists(testRoot)) Directory.Delete(testRoot, recursive: true);
        }
    }

    [Fact]
    public async Task LiveWorkflowRejectsConfigDisableDespiteInheritedProcessOverride()
    {
        var root = ToolchainTestHost.FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), $"workflow-egress-config-{Guid.NewGuid():N}");
        var outputDirectory = Path.Combine(testRoot, "delivery");
        var sourcePath = Path.Combine(testRoot, "exam.pdf");
        var promptPath = Path.Combine(testRoot, "prompt.md");
        var envPath = Path.Combine(testRoot, ".env");
        Directory.CreateDirectory(testRoot);
        File.WriteAllText(sourcePath, "%PDF-source");
        File.WriteAllText(promptPath, "# prompt");
        File.WriteAllText(envPath, "CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=false");

        try
        {
            var result = await RunAsyncWithEnvironment(
                "pwsh",
                root,
                new Dictionary<string, string?> { ["CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED"] = "true" },
                "-NoProfile", "-ExecutionPolicy", "Bypass",
                "-File", "scripts/run-live-answer-workflow.ps1",
                "-SourcePdf", sourcePath,
                "-OutputDirectory", outputDirectory,
                "-PromptFile", promptPath,
                "-ConfigEnvFile", envPath,
                "-AllowCloudEgress");

            result.ExitCode.Should().NotBe(0, result.Output);
            result.Output.Should().Contain("Live request blocked");
        }
        finally
        {
            if (Directory.Exists(testRoot)) Directory.Delete(testRoot, recursive: true);
        }
    }


    [Fact]
    public async Task LiveWorkflowForwardsExplicitEgressPermissionWithoutOverridingConfig()
    {
        var root = ToolchainTestHost.FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), $"workflow-egress-forward-{Guid.NewGuid():N}");
        var fakeNodeDirectory = Path.Combine(testRoot, "fake-node");
        var outputDirectory = Path.Combine(testRoot, "delivery");
        var requestMarker = Path.Combine(testRoot, "request.txt");
        var sourcePath = Path.Combine(testRoot, "exam.pdf");
        var promptPath = Path.Combine(testRoot, "prompt.md");
        var envPath = Path.Combine(testRoot, ".env");
        Directory.CreateDirectory(fakeNodeDirectory);
        File.WriteAllText(sourcePath, "%PDF-source");
        File.WriteAllText(promptPath, "# prompt");
        File.WriteAllText(envPath, "CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=true");
        WriteFakeNodeTool(fakeNodeDirectory, $$"""
                "review-source-pdf.mjs" {
                    $out = Get-Option "--out"
                    Write-Text (Join-Path $out "exam.page-1.png") "png"
                    Write-Text (Join-Path $out "manifest.json") '{"pages":[{}]}'
                }
                "answer-request.mjs" {
                    if ($toolArgs -notcontains "--allow-cloud-egress") { throw "explicit egress permission missing" }
                    if ($env:CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED -ne "true") { throw "verified config egress value was not propagated" }
                    Write-Text '{{requestMarker.Replace("'", "''")}}' "called"
                    $output = Get-Option "--output"
                    $mode = if ($toolArgs -contains "--semantic-findings-only") {
                        "semantic_review_findings"
                    } elseif ($toolArgs -contains "--semantic-findings-file") {
                        "semantic_review_merge"
                    } elseif ($toolArgs -contains "--audit-findings-only") {
                        "visual_audit_findings"
                    } elseif ($toolArgs -contains "--audit-findings-file") {
                        "visual_audit_merge"
                    } else {
                        "blind_generation"
                    }
                    Write-Text $output "# 物理试卷参考答案`n1. （1）**答案：** 合力满足 10 N。`n"
                    Write-SuccessSummary (Get-Option "--summary-out") $mode $output
                }
                "answer-diff-report.mjs" {
                    $evidenceIndex = [Array]::IndexOf($toolArgs, "--evidence-out")
                    if ($evidenceIndex -ge 0) {
                        Write-Text $toolArgs[$evidenceIndex + 1] (@{
                            schemaVersion = "1.0"
                            kind = "answer-review-evidence"
                            coveredQuestions = @(1)
                            confirmedCorrections = @()
                            directCorrections = @()
                            unresolvedQuestions = @()
                            missingQuestions = @()
                            diff = @{ lines = @(); added = 0; removed = 0 }
                        } | ConvertTo-Json -Depth 4 -Compress)
                    }
                    Write-Text $toolArgs[2] "# diff"
                }
                "deliver-answer.mjs" {
                    $pdf = [IO.Path]::GetFullPath($toolArgs[1])
                    $base = Join-Path ([IO.Path]::GetDirectoryName($pdf)) ([IO.Path]::GetFileNameWithoutExtension($pdf))
                    Write-Text $pdf "%PDF-delivery"
                    Write-Text ($base + ".snapshot.json") '{"snapshotId":"test"}'
                    Write-Text ($base + ".delivery-manifest.json") '{"kind":"delivery-manifest"}'
                }
                """);

        try
        {
            var result = await RunAsyncWithEnvironment(
                "pwsh",
                root,
                new Dictionary<string, string?> { ["PATH"] = fakeNodeDirectory + Path.PathSeparator + Environment.GetEnvironmentVariable("PATH") },
                "-NoProfile", "-ExecutionPolicy", "Bypass",
                "-File", "scripts/run-live-answer-workflow.ps1",
                "-SourcePdf", sourcePath,
                "-OutputDirectory", outputDirectory,
                "-PromptFile", promptPath,
                "-ConfigEnvFile", envPath,
                "-AllowCloudEgress");

            result.ExitCode.Should().Be(0, result.Output);
            File.Exists(requestMarker).Should().BeTrue();
        }
        finally
        {
            if (Directory.Exists(testRoot)) Directory.Delete(testRoot, recursive: true);
        }
    }

    [Fact]
    public async Task LiveWorkflowRejectsWorkflowReceiptCollisionBeforeRunningTools()
    {
        var root = ToolchainTestHost.FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-WorkflowReceiptCollision", Guid.NewGuid().ToString("N"));
        var outputDirectory = Path.Combine(testRoot, "delivery");
        var sourcePath = Path.Combine(testRoot, "exam.pdf");
        var referencePath = Path.Combine(outputDirectory, "exam.workflow-run.json");
        var promptPath = Path.Combine(testRoot, "prompt.md");
        var envPath = Path.Combine(testRoot, ".env");
        Directory.CreateDirectory(outputDirectory);
        File.WriteAllText(sourcePath, "%PDF-source");
        File.WriteAllText(referencePath, "authoritative-input");
        File.WriteAllText(promptPath, "# prompt");
        File.WriteAllText(envPath, "CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=true");

        try
        {
            var result = await RunAsync(
                "pwsh",
                root,
                "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-File", "scripts/run-live-answer-workflow.ps1",
                "-SourcePdf", sourcePath,
                "-ReferencePdf", referencePath,
                "-OutputDirectory", outputDirectory,
                "-PromptFile", promptPath,
                "-ConfigEnvFile", envPath);

            result.ExitCode.Should().NotBe(0);
            result.Output.Should().Contain("collides with input ReferencePdf");
            result.Output.Should().Contain("WorkflowReceipt");
            File.ReadAllText(referencePath).Should().Be("authoritative-input");
        }
        finally
        {
            if (Directory.Exists(testRoot)) Directory.Delete(testRoot, recursive: true);
        }
    }

    [Fact]
    public async Task LiveWorkflowWritesFailureReceiptWithBoundInputs()
    {
        var root = ToolchainTestHost.FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-WorkflowFailure", Guid.NewGuid().ToString("N"));
        var outputDirectory = Path.Combine(testRoot, "delivery");
        var sourcePath = Path.Combine(testRoot, "broken.pdf");
        var promptPath = Path.Combine(testRoot, "prompt.md");
        var envPath = Path.Combine(testRoot, ".env");
        var receiptPath = Path.Combine(outputDirectory, "broken.workflow-run.json");
        string? retainedWorkRoot = null;
        Directory.CreateDirectory(testRoot);
        File.WriteAllText(sourcePath, "not-a-pdf");
        File.WriteAllText(promptPath, "# prompt");
        File.WriteAllText(envPath, "CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=true");

        try
        {
            var result = await RunAsync(
                "pwsh",
                root,
                "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-File", "scripts/run-live-answer-workflow.ps1",
                "-SourcePdf", sourcePath,
                "-OutputDirectory", outputDirectory,
                "-PromptFile", promptPath,
                "-ConfigEnvFile", envPath,
                "-AllowCloudEgress");

            result.ExitCode.Should().NotBe(0);
            File.Exists(receiptPath).Should().BeTrue(result.Output);
            using var document = JsonDocument.Parse(File.ReadAllText(receiptPath));
            var receipt = document.RootElement;
            receipt.GetProperty("kind").GetString().Should().Be("live-answer-workflow-run");
            receipt.GetProperty("status").GetString().Should().Be("failed");
            receipt.GetProperty("inputs").GetProperty("sourcePdf").GetProperty("sha256").GetString()
                .Should().Be(Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(sourcePath))).ToLowerInvariant());
            retainedWorkRoot = receipt.GetProperty("diagnostics").GetProperty("retainedWorkRoot").GetString();
        }
        finally
        {
            if (!string.IsNullOrWhiteSpace(retainedWorkRoot) && Directory.Exists(retainedWorkRoot))
            {
                Directory.Delete(retainedWorkRoot, recursive: true);
            }
            if (Directory.Exists(testRoot)) Directory.Delete(testRoot, recursive: true);
        }
    }

    [Fact]
    public async Task LiveWorkflowFailureReceiptPreservesNodeDiagnostics()
    {
        var root = ToolchainTestHost.FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-WorkflowNodeFailure", Guid.NewGuid().ToString("N"));
        var fakeNodeDirectory = Path.Combine(testRoot, "fake-node");
        var outputDirectory = Path.Combine(testRoot, "delivery");
        var sourcePath = Path.Combine(testRoot, "exam.pdf");
        var referencePath = Path.Combine(testRoot, "exam-answers.pdf");
        var promptPath = Path.Combine(testRoot, "prompt.md");
        var envPath = Path.Combine(testRoot, ".env");
        var receiptPath = Path.Combine(outputDirectory, "exam.workflow-run.json");
        string? retainedWorkRoot = null;
        Directory.CreateDirectory(fakeNodeDirectory);
        Directory.CreateDirectory(Path.Combine(outputDirectory, "exam参考答案.review"));
        File.WriteAllText(sourcePath, "%PDF-source");
        File.WriteAllText(promptPath, "# prompt");
        File.WriteAllText(envPath, "CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=true");
        File.WriteAllText(Path.Combine(outputDirectory, "exam参考答案.md"), "# stale answer");
        File.WriteAllText(Path.Combine(outputDirectory, "exam参考答案.pdf"), "%PDF-stale");
        File.WriteAllText(Path.Combine(outputDirectory, "exam参考答案.delivery-manifest.json"), "{\"kind\":\"delivery-manifest\"}");
        File.WriteAllText(Path.Combine(outputDirectory, "exam参考答案.snapshot.json"), "{\"snapshotId\":\"stale\"}");
        File.WriteAllText(Path.Combine(outputDirectory, "exam参考答案.review", "page-001.png"), "stale review");
        WriteFakeNodeTool(fakeNodeDirectory, """
                "review-source-pdf.mjs" {
                    $out = Get-Option "--out"
                    Write-Text (Join-Path $out "exam.page-1.png") "png"
                    Write-Text (Join-Path $out "manifest.json") '{"pages":[{}]}'
                }
                "answer-request.mjs" {
                    [Console]::Error.WriteLine("provider diagnostics: status=503; attemptedRoles=primary,fallback_1")
                    exit 1
                }
                """);

        try
        {
            var pathValue = fakeNodeDirectory + Path.PathSeparator + Environment.GetEnvironmentVariable("PATH");
            var result = await RunAsyncWithEnvironment(
                "pwsh",
                root,
                new Dictionary<string, string?> { ["PATH"] = pathValue },
                "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-File", "scripts/run-live-answer-workflow.ps1",
                "-SourcePdf", sourcePath,
                "-OutputDirectory", outputDirectory,
                "-PromptFile", promptPath,
                "-ConfigEnvFile", envPath,
                "-AllowCloudEgress");

            result.ExitCode.Should().NotBe(0, result.Output);
            var receiptText = File.ReadAllText(receiptPath);
            using var document = JsonDocument.Parse(receiptText);
            var receipt = document.RootElement;
            receipt.GetProperty("status").GetString().Should().Be("failed");
            var blindPhase = receipt.GetProperty("phases").GetProperty("blindGeneration");
            blindPhase.GetProperty("error").GetString().Should().Contain("status=503");
            receipt.GetProperty("error").GetString().Should().Contain("status=503");
            var staleRunDirectory = Directory.GetDirectories(Path.Combine(outputDirectory, ".stale-runs")).Should().ContainSingle().Which;
            File.Exists(Path.Combine(staleRunDirectory, "exam参考答案.md")).Should().BeTrue();
            File.Exists(Path.Combine(staleRunDirectory, "exam参考答案.pdf")).Should().BeTrue();
            File.Exists(Path.Combine(staleRunDirectory, "exam参考答案.delivery-manifest.json")).Should().BeTrue();
            File.Exists(Path.Combine(staleRunDirectory, "exam参考答案.snapshot.json")).Should().BeTrue();
            File.Exists(Path.Combine(staleRunDirectory, "exam参考答案.review", "page-001.png")).Should().BeTrue();
            Directory.Exists(Path.Combine(outputDirectory, "exam参考答案.review")).Should().BeFalse();
            retainedWorkRoot = receipt.GetProperty("diagnostics").GetProperty("retainedWorkRoot").GetString();
        }
        finally
        {
            if (!string.IsNullOrWhiteSpace(retainedWorkRoot) && Directory.Exists(retainedWorkRoot))
            {
                Directory.Delete(retainedWorkRoot, recursive: true);
            }
            if (Directory.Exists(testRoot)) Directory.Delete(testRoot, recursive: true);
        }
    }

    [Fact]
    public async Task LiveWorkflowResumesHashBoundBlindCandidateWithoutRepeatingGeneration()
    {
        var root = ToolchainTestHost.FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-WorkflowResume", Guid.NewGuid().ToString("N"));
        var fakeNodeDirectory = Path.Combine(testRoot, "fake-node");
        var failedDirectory = Path.Combine(testRoot, "failed");
        var resumedDirectory = Path.Combine(testRoot, "resumed");
        var sourcePath = Path.Combine(testRoot, "exam.pdf");
        var referencePath = Path.Combine(testRoot, "exam-answers.pdf");
        var promptPath = Path.Combine(testRoot, "prompt.md");
        var envPath = Path.Combine(testRoot, ".env");
        var candidatePath = Path.Combine(failedDirectory, "exam盲答候选.md");
        var summaryPath = Path.Combine(failedDirectory, "exam.blind-generation.summary.json");
        var failedReceiptPath = Path.Combine(failedDirectory, "exam.workflow-run.json");
        Directory.CreateDirectory(fakeNodeDirectory);
        Directory.CreateDirectory(failedDirectory);
        File.WriteAllText(sourcePath, "%PDF-source");
        File.WriteAllText(referencePath, "%PDF-reference");
        File.WriteAllText(promptPath, "# prompt");
        File.WriteAllText(envPath, "CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=true");
        File.WriteAllText(candidatePath, "# 已完成的盲答\n");
        WriteMinimalBlindSummary(summaryPath, candidatePath);

        Dictionary<string, object> FileReceipt(string path)
        {
            var bytes = File.ReadAllBytes(path);
            return new Dictionary<string, object>
            {
                ["path"] = path,
                ["bytes"] = bytes.Length,
                ["sha256"] = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant()
            };
        }

        var priorReceipt = new Dictionary<string, object?>
        {
            ["kind"] = "live-answer-workflow-run",
            ["status"] = "failed",
            ["inputs"] = new Dictionary<string, object?>
            {
                ["sourcePdf"] = FileReceipt(sourcePath),
                ["referencePdf"] = FileReceipt(referencePath),
                ["prompt"] = FileReceipt(promptPath),
                ["blindFocusRegions"] = null,
                ["visualAuditFocusRegions"] = null,
                ["configEnv"] = FileReceipt(envPath)
            },
            ["options"] = new Dictionary<string, object?>
            {
                ["provider"] = "all",
                ["subjectPack"] = "junior-physics-answer",
                ["profile"] = "classroom",
                ["blindQualityProfile"] = "auto",
                ["semanticQualityProfile"] = "auto",
                ["visualQualityProfile"] = "auto",
                ["referenceQualityProfile"] = "auto",
                ["visualDetail"] = "original",
                ["maxOutputTokens"] = 24000,
                ["timeoutMs"] = 600000,
                ["reviewScale"] = 2.0,
                ["workflowReviewScale"] = 2.0,
                ["visualAuditScale"] = 4.0,
                ["blindFocusRegionsFile"] = null,
                ["visualAuditFocusRegionsFile"] = null,
                ["skipVisualAudit"] = true,
                ["keepReview"] = false,
                ["useGatewayProxy"] = false,
                ["allowCloudEgress"] = true,
                ["configEnvFile"] = envPath
            },
            ["phases"] = new Dictionary<string, object>
            {
                ["blindGeneration"] = new Dictionary<string, object>
                {
                    ["status"] = "completed",
                    ["summary"] = FileReceipt(summaryPath),
                    ["artifact"] = FileReceipt(candidatePath)
                }
            }
        };
        File.WriteAllText(failedReceiptPath, JsonSerializer.Serialize(priorReceipt));
        WriteFakeNodeTool(fakeNodeDirectory, """
                "review-source-pdf.mjs" {
                    $out = Get-Option "--out"
                    $prefix = if ($out -like "*reference-pages*") {
                        "reference"
                    } elseif ($out -like "*visual-audit-pages*") {
                        "visual"
                    } else {
                        "source"
                    }
                    Write-Text (Join-Path $out "$prefix.page-1.png") "png"
                    Write-Text (Join-Path $out "manifest.json") '{"pages":[{}]}'
                }
                "answer-request.mjs" {
                    $output = Get-Option "--output"
                    if ($output -like "*盲答候选.md") { throw "blind generation must not be called during resume" }
                    $mode = if ($toolArgs -contains "--semantic-findings-only") {
                        "semantic_review_findings"
                    } elseif ($toolArgs -contains "--semantic-findings-file") {
                        "semantic_review_merge"
                    } elseif ($toolArgs -contains "--reference-images-dir") {
                        "reference_review"
                    } else {
                        "blind_generation"
                    }
                    Write-Text $output "# 物理试卷参考答案`n1. （1）**答案：** 合力满足 10 N。`n"
                    Write-SuccessSummary (Get-Option "--summary-out") $mode $output
                }
                "answer-diff-report.mjs" {
                    $evidenceIndex = [Array]::IndexOf($toolArgs, "--evidence-out")
                    if ($evidenceIndex -ge 0) {
                        Write-Text $toolArgs[$evidenceIndex + 1] (@{
                            schemaVersion = "1.0"
                            kind = "answer-review-evidence"
                            coveredQuestions = @(1)
                            confirmedCorrections = @()
                            directCorrections = @()
                            unresolvedQuestions = @()
                            missingQuestions = @()
                            diff = @{ lines = @(); added = 0; removed = 0 }
                        } | ConvertTo-Json -Depth 4 -Compress)
                    }
                    Write-Text $toolArgs[2] "# diff`n"
                }
                "deliver-answer.mjs" {
                    $pdf = [IO.Path]::GetFullPath($toolArgs[1])
                    $base = Join-Path ([IO.Path]::GetDirectoryName($pdf)) ([IO.Path]::GetFileNameWithoutExtension($pdf))
                    Write-Text $pdf "%PDF-delivery"
                    Write-Text ($base + ".snapshot.json") '{"snapshotId":"test"}'
                    Write-Text ($base + ".delivery-manifest.json") '{"kind":"delivery-manifest"}'
                }
                """);

        try
        {
            var driftedOptions = await RunAsyncWithEnvironment(
                "pwsh",
                root,
                new Dictionary<string, string?> { ["PATH"] = fakeNodeDirectory + Path.PathSeparator + Environment.GetEnvironmentVariable("PATH") },
                "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-File", "scripts/run-live-answer-workflow.ps1",
                "-SourcePdf", sourcePath,
                "-ReferencePdf", referencePath,
                "-OutputDirectory", Path.Combine(testRoot, "drifted"),
                "-PromptFile", promptPath,
                "-ConfigEnvFile", envPath,
                "-ResumeFromWorkflowReceipt", failedReceiptPath,
                "-Provider", "primary",
                "-AllowCloudEgress");
            driftedOptions.ExitCode.Should().NotBe(0);
            driftedOptions.Output.Should().Contain("option does not match current provider");

            var pathValue = fakeNodeDirectory + Path.PathSeparator + Environment.GetEnvironmentVariable("PATH");
            var result = await RunAsyncWithEnvironment(
                "pwsh",
                root,
                new Dictionary<string, string?> { ["PATH"] = pathValue },
                "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-File", "scripts/run-live-answer-workflow.ps1",
                "-SourcePdf", sourcePath,
                "-ReferencePdf", referencePath,
                "-OutputDirectory", resumedDirectory,
                "-PromptFile", promptPath,
                "-ConfigEnvFile", envPath,
                "-ResumeFromWorkflowReceipt", failedReceiptPath,
                "-SkipVisualAudit",
                "-AllowCloudEgress");

            result.ExitCode.Should().Be(0, result.Output);
            using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(resumedDirectory, "exam.workflow-run.json")));
            var receipt = document.RootElement;
            receipt.GetProperty("status").GetString().Should().Be("succeeded");
            receipt.GetProperty("phases").GetProperty("blindGeneration").GetProperty("artifact").GetProperty("sha256").GetString()
                .Should().Be(FileReceipt(candidatePath)["sha256"].ToString());
            receipt.GetProperty("resume").GetProperty("workflowReceipt").GetProperty("sha256").GetString()
                .Should().Be(FileReceipt(failedReceiptPath)["sha256"].ToString());
            // The copied summary must be rewritten to point at this run's
            // artifact: a verbatim copy still carries the prior directory's
            // outputPath and would fail the real receipt validator's
            // summary.outputPath === phase.artifact.path rule. The fake node
            // stubs that validator, so assert the rewrite directly.
            using var resumedSummary = JsonDocument.Parse(File.ReadAllText(Path.Combine(resumedDirectory, "exam.blind-generation.summary.json")));
            resumedSummary.RootElement.GetProperty("outputPath").GetString()
                .Should().Be(Path.Combine(resumedDirectory, "exam盲答候选.md"));
        }
        finally
        {
            if (Directory.Exists(testRoot)) Directory.Delete(testRoot, recursive: true);
        }
    }

    [Fact]
    public async Task LiveWorkflowWritesSuccessReceiptAndBlocksPromptDrift()
    {
        var root = ToolchainTestHost.FindRepoRoot();
        var testRoot = Path.Combine(Path.GetTempPath(), "ClassroomToolkit-WorkflowSuccess", Guid.NewGuid().ToString("N"));
        var fakeNodeDirectory = Path.Combine(testRoot, "fake-node");
        var outputDirectory = Path.Combine(testRoot, "delivery");
        var sourcePath = Path.Combine(testRoot, "exam.pdf");
        var referencePath = Path.Combine(testRoot, "exam-answers.pdf");
        var promptPath = Path.Combine(testRoot, "prompt.md");
        var envPath = Path.Combine(testRoot, ".env");
        var receiptPath = Path.Combine(outputDirectory, "exam.workflow-run.json");
        string? retainedWorkRoot = null;
        Directory.CreateDirectory(fakeNodeDirectory);
        var controlledDeliveryRoot = WriteControlledDeliveryFixture(testRoot);
        File.WriteAllText(sourcePath, "%PDF-source");
        File.WriteAllText(referencePath, "%PDF-reference");
        File.WriteAllText(promptPath, "# prompt");
        File.WriteAllText(envPath, "CLASSROOM_TOOLKIT_CLOUD_EGRESS_ENABLED=true");
        WriteFakeNodeTool(fakeNodeDirectory, $$"""
                "review-source-pdf.mjs" {
                    $out = Get-Option "--out"
                    $prefix = if ($out -like "*reference-pages*") {
                        "reference"
                    } elseif ($out -like "*visual-audit-pages*") {
                        "visual"
                    } else {
                        "source"
                    }
                    Write-Text (Join-Path $out "$prefix.page-1.png") "png"
                    Write-Text (Join-Path $out "manifest.json") '{"pages":[{}]}'
                    if ($env:CLASSROOM_TOOLKIT_TEST_MUTATE_PROMPT -eq "true") {
                        Write-Text $env:CLASSROOM_TOOLKIT_TEST_PROMPT_PATH "# mutated prompt"
                    }
                    if ($env:CLASSROOM_TOOLKIT_TEST_MUTATE_VISUAL_CANDIDATE -eq "true") {
                        Write-Text (Join-Path $env:CLASSROOM_TOOLKIT_TEST_DELIVERY_ROOT "..\delivery\exam视觉审计候选.md") "# 参考复核前被篡改的候选`n"
                    }
                }
                "answer-request.mjs" {
                    $output = Get-Option "--output"
                    $mode = if ($toolArgs -contains "--semantic-findings-only") {
                        "semantic_review_findings"
                    } elseif ($toolArgs -contains "--semantic-findings-file") {
                        "semantic_review_merge"
                    } elseif ($toolArgs -contains "--audit-findings-only") {
                        "visual_audit_findings"
                    } elseif ($toolArgs -contains "--audit-findings-file") {
                        "visual_audit_merge"
                    } elseif ($toolArgs -contains "--reference-images-dir") {
                        "reference_review"
                    } else {
                        "blind_generation"
                    }
                    Write-Text $output "# 物理试卷参考答案`n1. （1）**答案：** 合力满足 10 N。`n"
                    Write-SuccessSummary (Get-Option "--summary-out") $mode $output
                    if ($mode -eq "reference_review" -and
                        $env:CLASSROOM_TOOLKIT_TEST_MUTATE_VISUAL_CANDIDATE -eq "true") {
                        $candidatePath = Get-Option "--candidate-file"
                        [IO.File]::AppendAllText($candidatePath, "`n被篡改的候选证据`n")
                    }
                }
                "answer-diff-report.mjs" {
                    $evidenceIndex = [Array]::IndexOf($toolArgs, "--evidence-out")
                    if ($evidenceIndex -ge 0) {
                        Write-Text $toolArgs[$evidenceIndex + 1] (@{
                            schemaVersion = "1.0"
                            kind = "answer-review-evidence"
                            coveredQuestions = @(1)
                            confirmedCorrections = @()
                            directCorrections = @()
                            unresolvedQuestions = @()
                            missingQuestions = @()
                            diff = @{ lines = @(); added = 0; removed = 0 }
                        } | ConvertTo-Json -Depth 4 -Compress)
                    }
                    Write-Text $toolArgs[2] "# diff`n"
                }
                "deliver-answer.mjs" {
                    & node "{{Path.Combine(controlledDeliveryRoot, "deliver-answer.mjs").Replace("\\", "/")}}" @toolArgs
                    if ($LASTEXITCODE -ne 0) { throw "Controlled delivery fixture failed" }
                }
                """, supportsControlledDelivery: true);

        try
        {
            var pathValue = fakeNodeDirectory + Path.PathSeparator + Environment.GetEnvironmentVariable("PATH");
            var result = await RunAsyncWithEnvironment(
                "pwsh",
                root,
                new Dictionary<string, string?>
                {
                    // The wrapper handles workflow tool names only. Put the
                    // real runtime ahead of it so fixture-internal child
                    // processes cannot re-enter fake-node recursively.
                    ["PATH"] = fakeNodeDirectory + Path.PathSeparator
                        + Path.GetDirectoryName(ToolchainTestHost.FindExecutableOnPath("node")) + Path.PathSeparator
                        + Environment.GetEnvironmentVariable("PATH"),
                    ["CLASSROOM_TOOLKIT_TEST_DELIVERY_ROOT"] = controlledDeliveryRoot,
                    ["CLASSROOM_TOOLKIT_TEST_LOG"] = "true",
                    ["CLASSROOM_TOOLKIT_TEST_DELIVERY_PROXY"] = "true"
                },
                "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-File", "scripts/run-live-answer-workflow.ps1",
                "-SourcePdf", sourcePath,
                "-ReferencePdf", referencePath,
                "-OutputDirectory", outputDirectory,
                "-PromptFile", promptPath,
                "-ConfigEnvFile", envPath,
                "-AllowCloudEgress");

            result.ExitCode.Should().Be(0, result.Output);
            using var document = JsonDocument.Parse(File.ReadAllText(receiptPath));
            var receipt = document.RootElement;
            receipt.GetProperty("status").GetString().Should().Be("succeeded");
            var phases = receipt.GetProperty("phases");
            phases.GetProperty("blindGeneration").GetProperty("status").GetString().Should().Be("completed");
            phases.GetProperty("semanticFindings").GetProperty("status").GetString().Should().Be("completed");
            phases.GetProperty("semanticMerge").GetProperty("status").GetString().Should().Be("completed");
            phases.GetProperty("visualFindings").GetProperty("status").GetString().Should().Be("completed");
            phases.GetProperty("visualMerge").GetProperty("status").GetString().Should().Be("completed");
            phases.GetProperty("referenceReview").GetProperty("status").GetString().Should().Be("completed");
            phases.GetProperty("delivery").GetProperty("status").GetString().Should().Be("completed");
            receipt.GetProperty("artifacts").EnumerateArray()
                .Select((artifact) => artifact.GetProperty("path").GetString()!)
                .Should().BeEquivalentTo(new[]
                {
                    Path.Combine(outputDirectory, "exam参考答案.md"),
                    Path.Combine(outputDirectory, "exam参考答案.pdf"),
                    Path.Combine(outputDirectory, "exam参考答案.delivery-manifest.json"),
                    Path.Combine(outputDirectory, "exam参考答案.snapshot.json"),
                    Path.Combine(outputDirectory, "exam语义复核发现.md"),
                    Path.Combine(outputDirectory, "exam.blind-generation.evidence.json"),
                    Path.Combine(outputDirectory, "exam语义复核候选.md"),
                    Path.Combine(outputDirectory, "exam盲答与语义复核差异报告.md"),
                    Path.Combine(outputDirectory, "exam.semantic-review-evidence.json"),
                    Path.Combine(outputDirectory, "exam视觉审计发现.md"),
                    Path.Combine(outputDirectory, "exam视觉审计候选.md"),
                    Path.Combine(outputDirectory, "exam盲答与视觉审计差异报告.md"),
                    Path.Combine(outputDirectory, "exam答案自动复核文本差异报告.md"),
                    Path.Combine(outputDirectory, "exam.reference-review-evidence.json")
                });
            File.Exists(Path.Combine(outputDirectory, "exam参考答案.pdf")).Should().BeTrue();
            Directory.GetFiles(Path.Combine(outputDirectory, "exam参考答案.review"), "*.png")
                .Should().NotBeEmpty();
            var tamperedOutputDirectory = Path.Combine(testRoot, "tampered-delivery");
            var tamperedReceiptPath = Path.Combine(tamperedOutputDirectory, "exam.workflow-run.json");
            var tamperedResult = await RunAsyncWithEnvironment(
                "pwsh",
                root,
                new Dictionary<string, string?>
                {
                    ["PATH"] = pathValue,
                    ["CLASSROOM_TOOLKIT_TEST_DELIVERY_ROOT"] = controlledDeliveryRoot,
                    ["CLASSROOM_TOOLKIT_TEST_DELIVERY_PROXY"] = "true",
                    ["CLASSROOM_TOOLKIT_TEST_MUTATE_VISUAL_CANDIDATE"] = "true"
                },
                "-NoProfile", "-ExecutionPolicy", "Bypass",
                "-File", "scripts/run-live-answer-workflow.ps1",
                "-SourcePdf", sourcePath,
                "-ReferencePdf", referencePath,
                "-OutputDirectory", tamperedOutputDirectory,
                "-PromptFile", promptPath,
                "-ConfigEnvFile", envPath,
                "-AllowCloudEgress");
            tamperedResult.ExitCode.Should().NotBe(0);
            tamperedResult.Output.Should().Contain("Reference review baseline does not match");
            using var tamperedDocument = JsonDocument.Parse(File.ReadAllText(tamperedReceiptPath));
            retainedWorkRoot = tamperedDocument.RootElement.GetProperty("diagnostics").GetProperty("retainedWorkRoot").GetString();

            var driftOutputDirectory = Path.Combine(testRoot, "drift-delivery");
            var driftReceiptPath = Path.Combine(driftOutputDirectory, "exam.workflow-run.json");
            File.WriteAllText(promptPath, "# frozen prompt");
            var frozenPromptSha = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(promptPath))).ToLowerInvariant();
            var driftResult = await RunAsyncWithEnvironment(
                "pwsh",
                root,
                new Dictionary<string, string?>
                {
                    ["PATH"] = pathValue,
                    ["CLASSROOM_TOOLKIT_TEST_MUTATE_PROMPT"] = "true",
                    ["CLASSROOM_TOOLKIT_TEST_PROMPT_PATH"] = promptPath,
                    ["CLASSROOM_TOOLKIT_TEST_DELIVERY_ROOT"] = controlledDeliveryRoot,
                    ["CLASSROOM_TOOLKIT_TEST_LOG"] = "true",
                    ["CLASSROOM_TOOLKIT_TEST_DELIVERY_PROXY"] = "true"
                },
                "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-File", "scripts/run-live-answer-workflow.ps1",
                "-SourcePdf", sourcePath,
                "-ReferencePdf", referencePath,
                "-OutputDirectory", driftOutputDirectory,
                "-PromptFile", promptPath,
                "-ConfigEnvFile", envPath,
                "-AllowCloudEgress");

            driftResult.ExitCode.Should().NotBe(0);
            driftResult.Output.Should().Contain("Workflow input drift detected for PromptFile");
            using var driftDocument = JsonDocument.Parse(File.ReadAllText(driftReceiptPath));
            var driftReceipt = driftDocument.RootElement;
            driftReceipt.GetProperty("status").GetString().Should().Be("failed");
            driftReceipt.GetProperty("inputs").GetProperty("prompt").GetProperty("sha256").GetString()
                .Should().Be(frozenPromptSha);
            retainedWorkRoot = driftReceipt.GetProperty("diagnostics").GetProperty("retainedWorkRoot").GetString();
        }
        finally
        {
            if (!string.IsNullOrWhiteSpace(retainedWorkRoot) && Directory.Exists(retainedWorkRoot))
            {
                Directory.Delete(retainedWorkRoot, recursive: true);
            }
            if (Directory.Exists(testRoot)) Directory.Delete(testRoot, recursive: true);
        }
    }

    private static async Task<ToolchainTestHost.ProcessResult> RunAsync(string fileName, string workingDirectory, params string[] arguments)
    {
        return await RunAsyncWithEnvironment(fileName, workingDirectory, environment: null, arguments);
    }

    private static void WriteMinimalBlindSummary(string summaryPath, string candidatePath)
    {
        var bytes = File.ReadAllBytes(candidatePath);
        File.WriteAllText(summaryPath, JsonSerializer.Serialize(new
        {
            schemaVersion = "1.3",
            kind = "live-answer-generation-summary",
            mode = "blind_generation",
            candidatePath = (string?)null,
            candidateSha256 = (string?)null,
            candidateBaselinePath = (string?)null,
            candidateBaselineSha256 = (string?)null,
            outputPath = candidatePath,
            outputSha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
            answerCharacters = 8,
            attempts = new[] { new { ok = true } }
        }));
    }

            // Shared node.cmd + fake-node.ps1 scaffold: the fake dispatches on the
            // invoked tool file name; toolBody supplies the per-test switch branches
            // on top of Get-Option/Write-Text helpers. The receipt validator is a
            // workflow-side stub; unknown tools still fail loudly.
    private static void WriteFakeNodeTool(string fakeNodeDirectory, string toolBody, bool supportsControlledDelivery = false)
    {
        Directory.CreateDirectory(fakeNodeDirectory);
        var powerShellExecutable = ToolchainTestHost.FindExecutableOnPath("pwsh");
        var realNodeExecutable = ToolchainTestHost.FindExecutableOnPath("node");
        File.WriteAllText(Path.Combine(fakeNodeDirectory, "real-node.cmd"),
            $"@echo off\r\n\"{realNodeExecutable}\" %*\r\nexit /b %ERRORLEVEL%\r\n");
        File.WriteAllText(Path.Combine(fakeNodeDirectory, "node.cmd"),
            $"@echo off\r\n\"{powerShellExecutable}\" -NoProfile -ExecutionPolicy Bypass -File \"%~dp0fake-node.ps1\" %*\r\nexit /b %ERRORLEVEL%\r\n");
        var fakeSummaryPath = Path.Combine(fakeNodeDirectory, "summary-functions.ps1");
        var fakeSummaryScript = $$"""
            $ErrorActionPreference = "Stop"
            function Get-Option([string]$Name) {
                for ($index = 0; $index -lt $toolArgs.Count - 1; $index++) {
                    if ($toolArgs[$index] -eq $Name) { return $toolArgs[$index + 1] }
                }
                return $null
            }
            function Write-Text([string]$PathValue, [string]$Value) {
                [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($PathValue))) | Out-Null
                [IO.File]::WriteAllText([IO.Path]::GetFullPath($PathValue), $Value, [Text.UTF8Encoding]::new($false))
            }
            function Write-SuccessSummary([string]$PathValue, [string]$ModeValue, [string]$OutputPath) {
                $rehash = {
                    param([AllowNull()][string]$BoundPath)
                    if (-not $BoundPath -or -not [IO.File]::Exists($BoundPath)) { return $null }
                    return [Convert]::ToHexString(
                        [Security.Cryptography.SHA256]::HashData([IO.File]::ReadAllBytes($BoundPath))).ToLowerInvariant()
                }
                $candidate = Get-Option "--candidate-file"
                $baseline = Get-Option "--candidate-baseline-file"
                $reference = Get-Option "--reference-pdf-file"
                $findings = Get-Option "--semantic-findings-file"
                $audit = Get-Option "--audit-findings-file"
                $output = Get-Option "--output"
                $summary = [ordered]@{
                    schemaVersion = "1.3"
                    kind = "live-answer-generation-summary"
                    generatedAt = [DateTimeOffset]::UtcNow.ToString("O")
                    provider = "fixture"
                    model = "fixture"
                    reasoningEffort = $null
                    promptPath = [IO.Path]::GetFullPath([string](Get-Option "--prompt-file"))
                    promptSha256 = "0000000000000000000000000000000000000000000000000000000000000000"
                    mode = $ModeValue
                    sourcePageCount = 1
                    auditImageCount = $(if (Get-Option "--audit-images-dir") { 1 } else { 0 })
                    referencePageCount = $(if (Get-Option "--reference-images-dir") { 1 } else { 0 })
                    requestedVisualDetailMode = "original"
                    providerVisualDetailMode = "original"
                    routing = [ordered]@{
                        mode = $ModeValue
                        qualityProfile = "auto"
                        requestedQualityProfile = "auto"
                        resolvedQualityProfile = "auto"
                        requestedPreset = "sol"
                        resolvedPreset = "sol"
                        activePreset = "sol"
                        qualityDegraded = $false
                        selectedRole = "fixture"
                        orderedPresets = @("sol")
                        orderedRoles = @("fixture")
                        orderedQualityProfiles = @("auto")
                        orderedExecutionSlots = @(1)
                        executionSlot = 1
                        executionSlotCount = 1
                        target = "fixture"
                        resolvedRole = "fixture"
                        attemptedRoles = @("fixture")
                    }
                    candidatePath = $(if (-not $candidate) { $null } else { [IO.Path]::GetFullPath($candidate) })
                    candidateSha256 = $(if (-not $candidate) { $null } else { & $rehash ([IO.Path]::GetFullPath($candidate)) })
                    candidateBaselinePath = $(if (-not $baseline) { $null } else { [IO.Path]::GetFullPath($baseline) })
                    candidateBaselineSha256 = $(if (-not $baseline) { $null } else { & $rehash ([IO.Path]::GetFullPath($baseline)) })
                    semanticFindingsPath = $(if (-not $findings) { $null } else { [IO.Path]::GetFullPath($findings) })
                    semanticFindingsSha256 = $(if (-not $findings) { $null } else { & $rehash ([IO.Path]::GetFullPath($findings)) })
                    auditFindingsPath = $(if (-not $audit) { $null } else { [IO.Path]::GetFullPath($audit) })
                    auditFindingsSha256 = $(if (-not $audit) { $null } else { & $rehash ([IO.Path]::GetFullPath($audit)) })
                    sourceTextPath = $null
                    sourceTextSha256 = $null
                    referenceTextPath = $null
                    referenceTextSha256 = $null
                    referencePdfPath = $(if (-not $reference) { $null } else { [IO.Path]::GetFullPath($reference) })
                    referencePdfSha256 = $(if (-not $reference) { $null } else { & $rehash ([IO.Path]::GetFullPath($reference)) })
                    pageCount = 1
                    pageImages = @()
                    outputPath = [IO.Path]::GetFullPath($output)
                    outputSha256 = & $rehash ([IO.Path]::GetFullPath($output))
                    answerCharacters = 8
                    referenceChoiceOverride = @{ applied = $false }
                    semanticChoiceOverride = @{ applied = $false; questions = @() }
                    attempts = @(
                        [ordered]@{
                            provider = "fixture"
                            model = "fixture"
                            reasoningEffort = $null
                            preset = "sol"
                            qualityProfile = "auto"
                            executionSlot = 1
                            status = 200
                            retryAfterMs = $null
                            ok = $true
                            retryable = $false
                            attemptNumber = 1
                            durationMs = 1
                            requestBytes = 1
                            transport = $null
                            error = ""
                        }
                    )
                }
                Write-Text $PathValue ($summary | ConvertTo-Json -Depth 20 -Compress)
            }
            """;
        File.WriteAllText(fakeSummaryPath, fakeSummaryScript);
        File.WriteAllText(Path.Combine(fakeNodeDirectory, "proxy.cjs"), """
            const path = require("node:path");
            const { spawnSync } = require("node:child_process");
            if (process.env.CLASSROOM_TOOLKIT_TEST_DELIVERY_PROXY !== "true") {
              throw new Error("The delivery proxy must run exactly once under the real Node runtime.");
            }
            const tool = process.argv[2];
            if (!tool || path.basename(tool) !== "deliver-answer.mjs") {
              throw new Error(`Real-node proxy received an unexpected tool: ${tool}`);
            }
            // Use Node's module hook rather than PATH lookup here. This models
            // deliver-answer's own child script without re-entering fake-node.
            const childArgs = process.argv.slice(3);
            const pdfArgument = childArgs.find((argument) => /\.pdf$/iu.test(argument));
            const markdownArgument = childArgs.find((argument) => /\.md$/iu.test(argument));
            if (!pdfArgument || !markdownArgument) throw new Error("Delivery proxy arguments are incomplete.");
            const input = path.resolve(process.env.INIT_CWD, markdownArgument);
            const output = path.resolve(process.env.INIT_CWD, pdfArgument);
            const fixtureRoot = process.env.CLASSROOM_TOOLKIT_TEST_DELIVERY_ROOT;
            const snapshotIndex = childArgs.indexOf("--snapshot-path");
            process.argv = [process.execPath, path.join(fixtureRoot, "deliver-answer.mjs"),
              "--input", input, "--output", output,
              "--snapshot-path", path.resolve(process.env.INIT_CWD, childArgs[snapshotIndex + 1])];
            const fixtureChild = spawnSync(process.execPath,
              [path.join(fixtureRoot, "deliver-answer.mjs"), ...process.argv.slice(2)],
              { stdio: "inherit", env: { ...process.env, CLASSROOM_TOOLKIT_TEST_DELIVERY_PROXY: "false" } });
            process.exit(fixtureChild.status ?? 2);
            """);
        var fakeScript = $$"""
            $ErrorActionPreference = "Stop"
            $tool = [IO.Path]::GetFileName($args[0])
            $toolArgs = [string[]]@($args | Select-Object -Skip 1)
            if ($tool -eq "deliver-answer.mjs" -and
                "{{supportsControlledDelivery.ToString().ToLowerInvariant()}}" -eq "true") {
                . "{{fakeSummaryPath.Replace("\\", "/")}}"
                if ($env:CLASSROOM_TOOLKIT_TEST_DELIVERY_PROXY -ne "true") {
                    throw "Nested delivery invocation detected; the real Node runtime must own the proxy."
                }
                $env:CLASSROOM_TOOLKIT_TEST_DELIVERY_PROXY = $null
                & (Join-Path $PSScriptRoot "real-node.cmd") @args
                if ($LASTEXITCODE -ne 0) { throw "Controlled delivery fixture failed" }
                return
            }
            . "{{fakeSummaryPath.Replace("\\", "/")}}"
            if ($env:CLASSROOM_TOOLKIT_TEST_LOG -eq "true") {
                $testRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
                $fixtureLog = Join-Path $testRoot "fake-node-invocations.log"
                [IO.File]::AppendAllText($fixtureLog, "$tool`n")
            }
            function Get-Option([string]$Name) {
                for ($index = 0; $index -lt $toolArgs.Count - 1; $index++) {
                    if ($toolArgs[$index] -eq $Name) { return $toolArgs[$index + 1] }
                }
                return $null
            }
            if ($tool -eq "write-delivery-manifest.mjs" -and
                "{{supportsControlledDelivery.ToString().ToLowerInvariant()}}" -eq "true") {
                $deliveryOutputIndex = [Array]::IndexOf($toolArgs, "--out")
                $deliveryInputIndex = [Array]::IndexOf($toolArgs, "--input")
                $deliveryPdfIndex = [Array]::IndexOf($toolArgs, "--output")
                $deliverySnapshotIndex = [Array]::IndexOf($toolArgs, "--snapshot-path")
                $deliveryReviewIndex = [Array]::IndexOf($toolArgs, "--review-dir")
                $deliveryReviewManifestIndex = [Array]::IndexOf($toolArgs, "--review-manifest")
                $deliveryScaleIndex = [Array]::IndexOf($toolArgs, "--review-scale")
                $requiredDeliveryIndexes = @($deliveryInputIndex, $deliveryPdfIndex, $deliverySnapshotIndex, $deliveryReviewIndex, $deliveryReviewManifestIndex)
                if (@($requiredDeliveryIndexes | Where-Object { $_ -lt 0 }).Count -gt 0) {
                    throw "Controlled delivery manifest arguments are incomplete."
                }
                $writerModule = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\controlled-fixture\fixture-writer.mjs"))
                $writerUrl = ([Uri]$writerModule).AbsoluteUri
                $nodeLines = @(
                    'const { writeDeliveryManifest } = await import(process.argv.splice(1, 1)[0]);'
                    'const errors = writeDeliveryManifest({ inputPath: process.argv[1], outputPath: process.argv[2], snapshotPath: process.argv[3], reviewDirectory: process.argv[4], reviewManifestPath: process.argv[5], reviewScale: process.argv[6], manifestPath: process.argv[0] });'
                    'if (errors.length) throw new Error(errors.join("\x5cn"));'
                    'console.log(process.argv[0]);'
                )
                $nodeCode = $nodeLines -join "`n"
                & node --input-type=module -e $nodeCode `
                    $writerUrl `
                    $(if ($deliveryOutputIndex -ge 0) { $toolArgs[$deliveryOutputIndex + 1] }) `
                    $toolArgs[$deliveryInputIndex + 1] $toolArgs[$deliveryPdfIndex + 1] `
                    $toolArgs[$deliverySnapshotIndex + 1] $toolArgs[$deliveryReviewIndex + 1] `
                    $toolArgs[$deliveryReviewManifestIndex + 1] `
                    $(if ($deliveryScaleIndex -ge 0) { $toolArgs[$deliveryScaleIndex + 1] } else { "2" })
                if ($LASTEXITCODE -ne 0) { throw "Controlled delivery writer failed" }
                return
            }
            # Get-Option/Write-Text/Write-SuccessSummary come from the dot-sourced
            # summary-functions.ps1 above; keep a single definition of each.
            switch ($tool) {
            {{toolBody}}
                "validate-workflow-receipt.mjs" { exit 0 }
                default { throw "Unexpected fake node tool: $tool" }
            }
            """;
        File.WriteAllText(Path.Combine(fakeNodeDirectory, "fake-node.ps1"), fakeScript);
    }

    private static string WriteControlledDeliveryFixture(string testRoot)
    {
        var repoRoot = ToolchainTestHost.FindRepoRoot();
        var fixtureRoot = Path.Combine(testRoot, "controlled-fixture");
        Directory.CreateDirectory(fixtureRoot);
        File.WriteAllBytes(Path.Combine(fixtureRoot, "review-page.fixture.png"),
            Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="));
        var writerModule = Path.Combine(repoRoot, "tools", "latex-renderer", "write-delivery-manifest.mjs")
            .Replace("\\", "/").Replace("'", "\\'");
        File.WriteAllText(Path.Combine(fixtureRoot, "fixture-writer.mjs"), $$"""
            export { writeDeliveryManifest } from '{{writerModule}}';
            """);
        var deliveryValidatorPath = Path.Combine(fixtureRoot, "deliver-answer.mjs");
        File.WriteAllText(deliveryValidatorPath, $$"""
            import fs from "node:fs";
            import path from "node:path";
            import crypto from "node:crypto";
            import { spawn } from "node:child_process";
            import { fileURLToPath } from "node:url";

            const deliveryRoot = process.env.CLASSROOM_TOOLKIT_TEST_DELIVERY_ROOT;
            const runtimeNode = process.execPath;
            const currentFilePath = fileURLToPath(import.meta.url);
            const pdfIndex = process.argv.findIndex((argument) => argument === "--output");
            const markdownIndex = process.argv.findIndex((argument) => argument === "--input");
            if (!deliveryRoot || pdfIndex < 1 || markdownIndex < 1) {
              throw new Error("Controlled delivery fixture arguments are incomplete.");
            }
            const deliveredArgument = process.argv.slice(1).find((argument) => /\.pdf$/iu.test(argument));
            if (deliveredArgument
                && path.isAbsolute(deliveredArgument)
                && path.isAbsolute(process.env.INIT_CWD)
                && !process.argv.includes("--snapshot-path")) {
              throw new Error(
                `The fake node.cmd intercepted the real delivery script. current=${currentFilePath};`
                + ` INIT_CWD=${process.env.INIT_CWD}; output=${deliveredArgument}`
              );
            }
            const pdfPath = path.resolve(process.env.INIT_CWD, process.argv[pdfIndex + 1]);
            const markdownPath = path.resolve(process.env.INIT_CWD, process.argv[markdownIndex + 1]);
            const baseName = path.basename(pdfPath, path.extname(pdfPath));
            const basePath = path.join(path.dirname(pdfPath), baseName);
            const snapshotPath = `${basePath}.snapshot.json`;
            const manifestPath = `${basePath}.delivery-manifest.json`;
            const reviewRoot = `${basePath}.review`;
            fs.mkdirSync(reviewRoot, { recursive: true });

            const snapshotIndex = process.argv.indexOf("--snapshot-path");
            if (snapshotIndex < 1) throw new Error("Controlled delivery fixture has no snapshot.");
            const sourceSnapshot = path.resolve(process.env.INIT_CWD, process.argv[snapshotIndex + 1]);
            fs.copyFileSync(sourceSnapshot, snapshotPath);
            fs.writeFileSync(pdfPath, Buffer.from([
              "%PDF-1.4\n",
              "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
              "2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n",
              "trailer\n<< /Root 1 0 R /Size 3 >>\n%%EOF\n"
            ].join(""), "ascii"));
            if (!pdfPath.startsWith(process.env.INIT_CWD)) {
              throw new Error(`Controlled delivery output escaped its fixture root: ${pdfPath}`);
            }
            const reviewManifestPath = path.join(reviewRoot, "manifest.json");
            const imagePath = path.join(reviewRoot, "page-001.png");
            fs.writeFileSync(imagePath, fs.readFileSync(path.join(deliveryRoot, "review-page.fixture.png")));
            const pdfBytes = fs.readFileSync(pdfPath);
            fs.writeFileSync(reviewManifestPath, `${JSON.stringify({
              schemaVersion: "1.0",
              kind: "pdf-source-review",
              inputPath: `../${path.basename(pdfPath)}`,
              inputSha256: crypto.createHash("sha256").update(pdfBytes).digest("hex"),
              inputBytes: pdfBytes.byteLength,
              pageCount: 1,
              selectedPages: [1],
              pages: [{
                pageNumber: 1,
                kind: "page",
                horizontalIndex: 0,
                imagePath,
                width: 1,
                height: 1
              }]
            }, null, 2)}\n`);
            // write-delivery-manifest owns the review package rewrite. The
            // renderer only supplies a source review; the package copy and its
            // HTML are the same objects a real delivery emits.
            const fixtureModule = await import(
              "{{new Uri(Path.Combine(fixtureRoot, "fixture-writer.mjs")).AbsoluteUri}}"
            );
            const errors = fixtureModule.writeDeliveryManifest({
              inputPath: markdownPath,
              outputPath: pdfPath,
              snapshotPath,
              reviewDirectory: reviewRoot,
              reviewManifestPath,
              reviewScale: "2",
              manifestPath
            });
            const nestedExit = await new Promise((resolve, reject) => {
              const child = spawn(runtimeNode, ["-e", "process.exit(0)"], { stdio: "ignore" });
              const watchdog = setTimeout(() => {
                child.kill();
                reject(new Error("Controlled fixture nested Node runtime timed out."));
              }, 15_000);
              child.once("error", reject);
              child.once("exit", (code) => {
                clearTimeout(watchdog);
                resolve(code);
              });
            });
            if (nestedExit !== 0) {
              throw new Error(`Controlled fixture nested runtime exited ${nestedExit}.`);
            }
            const validatorModule = "{{Path.Combine(repoRoot, "tools", "latex-renderer", "validate-delivery-manifest.mjs").Replace("\\", "/")}}";
            const validation = await new Promise((resolve, reject) => {
              const child = spawn(runtimeNode, [validatorModule, "--help"], {
                stdio: ["ignore", "pipe", "pipe"],
                env: { ...process.env, INIT_CWD: repoRoot }
              });
              let output = "";
              child.stdout.on("data", (chunk) => { output += chunk; });
              child.stderr.on("data", (chunk) => { output += chunk; });
              const watchdog = setTimeout(() => {
                child.kill();
                reject(new Error("Real Node validator smoke timed out."));
              }, 15_000);
              child.once("error", reject);
              child.once("exit", (code) => {
                clearTimeout(watchdog);
                resolve({ code, output });
              });
            });
            if (validation.code !== 0 || !validation.output.includes("Usage: node validate-delivery-manifest.mjs")) {
              throw new Error(`Real Node validator smoke failed: ${validation.output}`);
            }
            const written = { status: errors.length === 0 ? 0 : 1,
              stderr: errors.join("\n") };
            if (written.status !== 0) {
              throw new Error(`Controlled delivery writer failed for ${markdownPath} -> ${pdfPath}:\n${written.stderr}`);
            }
            console.log(manifestPath);
            """);
        return fixtureRoot;
    }
    private static void CreateTransferPackage(
        string packagePath,
        IReadOnlyDictionary<string, string> files,
        params string[] manifestPaths)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(packagePath)!);
        using var archive = ZipFile.Open(packagePath, ZipArchiveMode.Create);
        foreach (var (relativePath, content) in files)
        {
            WriteZipEntry(archive, relativePath, Encoding.UTF8.GetBytes(content));
        }

        var manifestFiles = manifestPaths.Select(relativePath =>
        {
            var bytes = Encoding.UTF8.GetBytes(files[relativePath]);
            return new
            {
                path = relativePath,
                bytes = bytes.LongLength,
                sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant()
            };
        }).ToArray();
        var manifest = JsonSerializer.SerializeToUtf8Bytes(new
        {
            schemaVersion = "1.0",
            kind = "classroom-toolkit-transfer",
            mode = "PrivateDev",
            sourceCommit = new string('a', 40),
            envIncluded = false,
            gitIncluded = false,
            publishedAppIncluded = false,
            files = manifestFiles
        });
        WriteZipEntry(archive, "transfer-manifest.json", manifest);
    }

    private static void WriteZipEntry(ZipArchive archive, string relativePath, byte[] content)
    {
        var entry = archive.CreateEntry(relativePath, CompressionLevel.Fastest);
        using var stream = entry.Open();
        stream.Write(content);
    }

    private static async Task<ToolchainTestHost.ProcessResult> RunAsyncWithEnvironment(
        string fileName,
        string workingDirectory,
        IReadOnlyDictionary<string, string?>? environment,
        params string[] arguments)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = fileName,
            WorkingDirectory = workingDirectory,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        if (environment is not null)
        {
            foreach (var (key, value) in environment) startInfo.Environment[key] = value;
        }
        foreach (var argument in arguments) startInfo.ArgumentList.Add(argument);

        using var process = Process.Start(startInfo) ?? throw new InvalidOperationException($"Unable to start {fileName}.");
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
            throw new TimeoutException($"{fileName} did not exit within two minutes.");
        }

        var output = (await stdoutTask) + Environment.NewLine + (await stderrTask);
        return new ToolchainTestHost.ProcessResult(process.ExitCode, output);
    }

    [Fact]
    public async Task ArtifactCleanupRefusesARootThatIsNotAnArtifactsDirectory()
    {
        var root = ToolchainTestHost.FindRepoRoot();
        var result = await RunAsync(
            "pwsh",
            root,
            "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/clean-artifacts.ps1",
            "-ArtifactsRoot", ".",
            "-KeepVersion", "1.0.1");

        result.ExitCode.Should().NotBe(0);
        result.NormalizedOutput.Should().Contain("must be a directory named 'artifacts'");
        // The guard exists to protect tracked source: prove it survived.
        Directory.Exists(Path.Combine(root, "tools")).Should().BeTrue();
        Directory.Exists(Path.Combine(root, "src")).Should().BeTrue();
        File.Exists(Path.Combine(root, "ClassroomToolkit.sln")).Should().BeTrue();
    }

    [Fact]
    public async Task ArtifactCleanupRefusesADriveRoot()
    {
        var driveRoot = Path.GetPathRoot(ToolchainTestHost.FindRepoRoot())!;
        var result = await RunAsync(
            "pwsh",
            ToolchainTestHost.FindRepoRoot(),
            "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/clean-artifacts.ps1",
            "-ArtifactsRoot", driveRoot,
            "-KeepVersion", "1.0.1");

        result.ExitCode.Should().NotBe(0);
        result.NormalizedOutput.Should().Contain("must be a directory named 'artifacts'");
    }

    [Fact]
    public async Task AppPublishRefusesAPublishDirectoryOutsideArtifactsWork()
    {
        var result = await RunAsync(
            "pwsh",
            ToolchainTestHost.FindRepoRoot(),
            "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/publish-app.ps1",
            "-PublishDir", ".");

        result.ExitCode.Should().NotBe(0);
        result.NormalizedOutput.Should().Contain("must stay under");
    }

    [Fact]
    public async Task SnapshotCliRejectsASubjectPackThatEscapesTheRepository()
    {
        var result = await RunAsync(
            "node",
            ToolchainTestHost.FindRepoRoot(),
            "tools/rule-compiler/compile-snapshot.mjs",
            "--subject-pack", "../../../etc",
            "--profile", "classroom");

        result.ExitCode.Should().NotBe(0);
        result.NormalizedOutput.Should().Contain("Invalid subject pack id");
    }
}
