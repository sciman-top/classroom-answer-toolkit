# Global rule 9.73 project-contract evidence

- Repository: `classroom-answer-toolkit`
- Scope: project rule mapping only; no business-code or host-runtime mutation.
- Official basis: current Codex AGENTS loading/precedence and rules semantics; Claude platform delta remains separately verified.
- Git profile: baseline=`main`; upstream=`origin/main`.
- Before AGENTS SHA-256: `F764A5988815FA03FA4841E40D220FC86FB7F28BCCC1A8FACF499775376E4F43`
- After AGENTS SHA-256: `5ECB09AE9CEA144BCF5F47DBB097E113F35F782E69E86BEA9926F5BAE4F21D61`
- Planned gate: `pwsh -NoProfile -File scripts/check-toolchain.ps1`
- Current verification: Core toolchain passed; assets/config, 17 answer tests, 3 output-path tests, eval/runtime/render and junior-physics-answer snapshots/eval passed.
- N/A: host loading and live acceptance remain outside repository-static verification.
- Rollback: revert only this repository's `AGENTS.md` and this evidence file to the recorded before hash.
- Truth boundary: `repo_verified=passed`; `host_loaded=codex_fresh_prompt_verified`; `claude_loaded=not_run`; `live_accepted=not_run`.
