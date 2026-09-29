.DEFAULT_GOAL := help

# The lint toolchain, pinned by manifest-list digest. The v-tag rides along for
# readability; the digest is what resolves, so bump both together.
CI_TOOLS_IMAGE ?= ghcr.io/knight-owl-dev/ci-tools:v1.5.0@sha256:e6f787624a5b19f7784c550a728d3574108f12488fb1f835f91bccdba7c3e32f

TEST_IMAGE ?= prettier-plugin-pandoc-test:local

# Whether a human is watching, probed once.
IS_TTY := $(shell test -t 0 && echo 1)

# Pass `-t` to `docker run` when stdin is a terminal, so TTY-aware tools see a
# real terminal inside the container.
DOCKER_TTY ?= $(if $(IS_TTY),-t)

.PHONY: resolve test test-image lint lint-fix lint-docker lint-js lint-js-fix \
	lint-md lint-md-fix lint-spell help

# Node and npm come from the test image, never the host. It runs as the
# invoking user, so node_modules on the mount stays the host's to delete.
TEST_RUNNER = docker run --rm $(DOCKER_TTY) --user "$$(id -u):$$(id -g)" \
	-e HOME=/tmp -v "$(CURDIR):/work" -w /work $(TEST_IMAGE)

# No build context: the image copies nothing from the repo.
test-image:
	@docker build -q -t $(TEST_IMAGE) - < test/Dockerfile > /dev/null

# npm writes this file on every install, so it dates the tree it describes.
node_modules/.package-lock.json: package-lock.json | test-image
	@$(TEST_RUNNER) npm ci --ignore-scripts

# Re-resolve the dependency tree into package-lock.json
resolve: test-image
	@$(TEST_RUNNER) npm install --ignore-scripts

# Run every package's tests, the Pandoc oracle included
test: test-image node_modules/.package-lock.json
	@$(TEST_RUNNER) node --test

# The lint targets invoke their tools bare; the aggregate targets re-enter the
# ci-tools image, so the toolchain is the pinned one wherever make runs.
LINT_TARGETS := lint-docker lint-js lint-md lint-spell

LINT_RUNNER ?= docker run --rm $(DOCKER_TTY) \
	-v "$(CURDIR):/work" -w /work $(CI_TOOLS_IMAGE) make

lint:
	@$(LINT_RUNNER) $(LINT_TARGETS)

lint-fix:
	@$(LINT_RUNNER) lint-js-fix lint-md-fix

lint-docker:
	@echo "Linting Dockerfile..." && hadolint test/Dockerfile && echo "OK"

# --error-on-warnings: Biome reports most rules as warnings, which would
# otherwise exit 0.
lint-js:
	@echo "Checking JavaScript..." && biome check --error-on-warnings && echo "OK"

lint-js-fix:
	@echo "Fixing JavaScript..." && biome check --write && echo "OK"

lint-md:
	@echo "Linting Markdown..." && markdownlint-cli2 '**/*.md' && echo "OK"

lint-md-fix:
	@echo "Fixing Markdown..." && markdownlint-cli2 --fix '**/*.md' && echo "OK"

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
	@echo "  make lint-docker       Lint the test image Dockerfile"
	@echo "  make lint-js           Lint and format-check JavaScript (biome)"
	@echo "  make lint-js-fix       Fix JavaScript formatting and lint issues"
	@echo "  make lint-md           Lint Markdown files"
	@echo "  make lint-md-fix       Fix Markdown files"
	@echo "  make lint-spell        Check spelling"
	@echo "  make help              Show this message"
	@echo ""
