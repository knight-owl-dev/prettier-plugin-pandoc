.DEFAULT_GOAL := help

# The lint toolchain, pinned by manifest-list digest. The v-tag rides along for
# readability; the digest is what resolves, so bump both together.
CI_TOOLS_IMAGE ?= ghcr.io/knight-owl-dev/ci-tools:v1.6.1@sha256:822d75b014b3de9859297439df2d31b3a761a293db5d0b1874cd18c77f03068f

# Whether a human is watching, probed once.
IS_TTY := $(shell test -t 0 && echo 1)

# Pass `-t` to `docker run` when stdin is a terminal, so TTY-aware tools see a
# real terminal inside the container.
DOCKER_TTY ?= $(if $(IS_TTY),-t)

.PHONY: resolve test test-image lint lint-fix lint-actions lint-docker lint-js \
	lint-js-fix lint-md lint-md-fix lint-md-fmt lint-md-fmt-fix lint-sh lint-spell help \
	fuzz-print fuzz-parser shrink probe snapshots-diff snapshots-write bench \
	bench-compare pandoc-lint bun-check

# Node, npm and Pandoc come from the compose services (docker-compose.yaml),
# never the host. They run as the invoking user, so node_modules on the mount
# stays the host's to delete.
COMPOSE = DOCKER_UID=$$(id -u) DOCKER_GID=$$(id -g) docker compose --progress quiet

# Each command in the `node` service, killed after TIMEOUT seconds: a hung
# parse otherwise blocks forever.
TIMEOUT ?= 1800
RUN = tools/run.sh $(TIMEOUT)

test-image:
	@$(COMPOSE) build node

# npm writes this file on every install, so it dates the tree it describes.
node_modules/.package-lock.json: package-lock.json | test-image
	@$(COMPOSE) run --rm -T npm ci --ignore-scripts

# Re-resolve the dependency tree into package-lock.json
resolve: test-image
	@$(COMPOSE) run --rm -T npm install --ignore-scripts

# Run every package's tests, the Pandoc oracle included
test: test-image node_modules/.package-lock.json
	@$(RUN) node --test

# The tools: docs/playbook.md says when to reach for each.
N ?= 1500
SEED ?= 1
SHOW ?= 4
KIND ?= markdown
EXT ?=
LINE ?= 1
FORMAT ?= markdown
WHAT ?= all
REF ?= main
RUNS ?= 5

fuzz-print: test-image node_modules/.package-lock.json
	@$(RUN) node tools/fuzz/print.mjs $(N) $(SEED) $(SHOW)

fuzz-parser: test-image node_modules/.package-lock.json
	@$(RUN) node tools/fuzz/parser.mjs $(KIND) $(N) $(SEED) $(SHOW) '$(EXT)'

shrink: test-image node_modules/.package-lock.json
	@test -n "$(CASE)" || { echo "CASE=<cases.jsonl> [LINE=n]" >&2; exit 2; }
	@$(RUN) node tools/shrink.mjs '$(CASE)' $(LINE)

probe: test-image node_modules/.package-lock.json
	@$(RUN) node tools/probe.mjs '$(FILE)' '$(FORMAT)' '$(SPANS)'

snapshots-diff: test-image node_modules/.package-lock.json
	@$(RUN) node tools/snapshots.mjs diff $(KEYS)

snapshots-write: test-image node_modules/.package-lock.json
	@$(RUN) node tools/snapshots.mjs write $(KEYS)

bench: test-image node_modules/.package-lock.json
	@$(RUN) env COMMIT=$$(git rev-parse --short HEAD) \
		node tools/bench/run.mjs $(WHAT) HEAD $(RUNS)

pandoc-lint: test-image node_modules/.package-lock.json
	@test -n "$(FILES)" || { echo "FILES=<file.md ...> [ARGS]" >&2; exit 2; }
	@$(RUN) node packages/pandoc-lint/src/cli.js $(ARGS) $(FILES)

# What pandoc-lint lints in the Bun check: the corpus, and a shortcuts file.
BUN_CHECK_ARGS = --shortcuts=packages/pandoc-lint/test/fixtures/shortcuts.yaml \
	packages/prettier-plugin-pandoc/test/corpus/*.md

bun-check: test-image node_modules/.package-lock.json
	@$(COMPOSE) build bun
	@$(COMPOSE) run --rm -T bun tools/bun/check.sh $(BUN_CHECK_ARGS)
	@$(RUN) sh -c 'node packages/pandoc-lint/src/cli.js --format=json --info \
		$(BUN_CHECK_ARGS) > .scratch/bun/node.json || true'
	@cmp .scratch/bun/node.json .scratch/bun/bun.json \
		&& echo "Bun's JSON is Node's"

# The baseline runs in a worktree of REF; this checkout's documents feed both.
bench-compare: test-image node_modules/.package-lock.json
	@tools/baseline.sh add $(REF)
	@$(RUN) env ROOT=/work/.scratch/wt/base COMMIT=$$(git rev-parse --short $(REF)) \
		node tools/bench/run.mjs $(WHAT) base $(RUNS); \
		status=$$?; tools/baseline.sh remove; test $$status -eq 0
	@$(MAKE) --no-print-directory bench
	@$(RUN) node tools/bench/compare.mjs base HEAD

# The lint targets invoke their tools bare; the aggregate targets re-enter the
# ci-tools image, so the toolchain is the pinned one wherever make runs.
LINT_TARGETS := lint-actions lint-docker lint-js lint-md lint-md-fmt lint-sh lint-spell

LINT_RUNNER ?= docker run --rm $(DOCKER_TTY) -e GITHUB_TOKEN \
	-v "$(CURDIR):/work" -w /work $(CI_TOOLS_IMAGE) make

lint:
	@$(LINT_RUNNER) $(LINT_TARGETS)

lint-fix:
	@$(LINT_RUNNER) lint-js-fix lint-md-fmt-fix lint-md-fix

# validate-action-pins checks each SHA against its tag's comment through the
# GitHub API, which GITHUB_TOKEN keeps under the rate limit.
lint-actions:
	@echo "Linting GitHub Actions..." && actionlint .github/workflows/*.yml && echo "OK"
	@echo "Validating GitHub Actions pins..." \
		&& validate-action-pins .github/workflows/*.yml && echo "OK"

lint-sh:
	@echo "Linting shell scripts..." && shellcheck tools/*.sh tools/*/*.sh && echo "OK"

lint-docker:
	@echo "Linting Dockerfile..." && hadolint tools/Dockerfile tools/bun.Dockerfile && echo "OK"

# --error-on-warnings: Biome reports most rules as warnings, which would
# otherwise exit 0.
lint-js:
	@echo "Checking JavaScript and JSON..." && biome check --error-on-warnings && echo "OK"

lint-js-fix:
	@echo "Fixing JavaScript and JSON..." && biome check --write && echo "OK"

lint-md:
	@echo "Linting Markdown..." && markdownlint-cli2 '**/*.md' && echo "OK"

lint-md-fix:
	@echo "Fixing Markdown..." && markdownlint-cli2 --fix '**/*.md' && echo "OK"

# Options live in the files prettier reads, so an editor formats as this does.
lint-md-fmt:
	@echo "Checking Markdown formatting..." && prettier --check '**/*.md' && echo "OK"

lint-md-fmt-fix:
	@echo "Formatting Markdown..." && prettier --write --log-level warn '**/*.md' && echo "OK"

# --gitignore reuses .gitignore, so ignore paths live in one place.
lint-spell:
	@echo "Checking spelling..." && cspell --no-progress --gitignore '**/*' && echo "OK"

help:
	@echo ""
	@echo "prettier-plugin-pandoc Commands:"
	@echo "  make test              Run all tests, the Pandoc oracle included"
	@echo "  make resolve           Re-resolve package-lock.json"
	@echo "  make lint              Run all linters"
	@echo "  make lint-fix          Fix all auto-fixable lint issues"
	@echo "  make lint-actions      Lint workflows and verify action pins"
	@echo "  make lint-docker       Lint the Dockerfiles (test image, Bun)"
	@echo "  make lint-sh           Lint the shell scripts (shellcheck)"
	@echo "  make lint-js           Lint and format-check JavaScript and JSON (biome)"
	@echo "  make lint-js-fix       Fix JavaScript and JSON formatting and lint issues"
	@echo "  make lint-md           Lint Markdown files"
	@echo "  make lint-md-fix       Fix Markdown files"
	@echo "  make lint-md-fmt       Check Markdown formatting (prettier)"
	@echo "  make lint-md-fmt-fix   Format Markdown files (prettier)"
	@echo "  make lint-spell        Check spelling"
	@echo "  make help              Show this message"
	@echo ""
	@echo "Tools (docs/playbook.md; TIMEOUT=seconds kills a hung run):"
	@echo "  make fuzz-print        Fuzz the plugin against Pandoc [N SEED SHOW]"
	@echo "  make fuzz-parser       Fuzz pandoc-parser against Pandoc [KIND N SEED SHOW EXT]"
	@echo "  make shrink            Shrink a fuzz failure (CASE=<file.jsonl> [LINE])"
	@echo "  make probe             Pandoc's read beside pandoc-parser's [FILE FORMAT SPANS=1]"
	@echo "  make snapshots-diff    Diff the plugin's output against its snapshots [KEYS]"
	@echo "  make snapshots-write   Make the plugin's output its snapshots [KEYS]"
	@echo "  make bench             Benchmark the parser and plugin [WHAT RUNS]"
	@echo "  make bench-compare     Benchmark against REF (default main) [WHAT RUNS]"
	@echo "  make pandoc-lint       Lint a manuscript (FILES=<file.md ...> [ARGS])"
	@echo "  make bun-check         Compile pandoc-lint with Bun; check it lints as Node does"
	@echo ""
