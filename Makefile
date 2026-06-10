SHELL := /bin/bash

PROD_PROJECT := fairshare-4c9a2
DEV_PROJECT  := fairshare-split-dev
PROD_URL     := https://fairshare-split.web.app
DEV_URL      := https://dev-fairshare-split.web.app

.DEFAULT_GOAL := help
.PHONY: help versions test promote rollback-prod deploy-rules-dev deploy-rules-prod watch open-prod open-dev

help: ## List available commands
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# The SPA rewrite serves index.html for unknown paths, so a missing
# version.json comes back as HTML with HTTP 200 — check it's JSON
define fetch_version
	RESP=$$(curl -sf $(1)/version.json); case "$$RESP" in \
		"{"*) echo "$$RESP";; \
		*) echo "unknown (no version.json deployed yet)";; \
	esac
endef

versions: ## Show what's running on prod and dev vs local HEAD
	@printf "prod:  "; $(call fetch_version,$(PROD_URL))
	@printf "dev:   "; $(call fetch_version,$(DEV_URL))
	@printf "local: {\"version\":\"%s\",\"sha\":\"%s\",\"branch\":\"%s\"}\n" \
		"$$(node -p "require('./package.json').version")" \
		"$$(git rev-parse --short HEAD)" \
		"$$(git branch --show-current)"

test: ## Run the test suite and a production build
	npm test && npm run build

promote: ## Merge dev → main (CI deploys prod hosting), then deploy prod rules
	git fetch -q origin
	@if [ -z "$$(git log --oneline origin/main..origin/dev)" ]; then \
		echo "Nothing to promote — origin/dev has no commits ahead of origin/main."; exit 1; fi
	@echo "Commits to promote:" && git log --oneline origin/main..origin/dev | sed 's/^/  /'
	@gh pr create --base main --head dev --title "Promote dev to prod" \
		--body "Automated promotion via \`make promote\`." 2>/dev/null || echo "(reusing existing dev → main PR)"
	gh pr merge dev --merge
	npx firebase deploy --only firestore --project $(PROD_PROJECT) --non-interactive
	@echo "✅ Prod rules deployed. Hosting deploys via CI — follow with 'make watch', verify with 'make versions'."

rollback-prod: ## Rebuild prod hosting from a previous commit (REF=..., default origin/main~1). Rules/data are NOT rolled back.
	@echo "Tip: Firebase console → Hosting → Release history has instant one-click rollback (no rebuild)."
	@grep -q "VITE_FIREBASE_PROJECT_ID=$(PROD_PROJECT)" .env || \
		{ echo "✋ .env isn't pointing at prod ($(PROD_PROJECT)) — local rollback builds use .env config. Aborting."; exit 1; }
	git fetch -q origin
	@REF=$${REF:-origin/main~1}; \
	SHA=$$(git rev-parse --short $$REF) || exit 1; \
	echo "Rolling prod hosting back to $$SHA ($$REF)"; \
	TMP=$$(mktemp -d); \
	git worktree add --detach -q $$TMP $$REF && \
	cp .env $$TMP/.env && \
	( cd $$TMP && npm ci --silent && npm run build && \
	  npx firebase deploy --only hosting:app --project $(PROD_PROJECT) --non-interactive ); \
	STATUS=$$?; \
	git worktree remove --force $$TMP; \
	exit $$STATUS

deploy-rules-dev: ## Deploy Firestore rules + indexes to the DEV project
	npx firebase deploy --only firestore --project $(DEV_PROJECT) --non-interactive

deploy-rules-prod: ## Deploy Firestore rules + indexes to PROD
	npx firebase deploy --only firestore --project $(PROD_PROJECT) --non-interactive

watch: ## Watch the latest CI run, then report what (if anything) it deployed
	@ID=$$(gh run list -L1 --json databaseId -q '.[0].databaseId'); \
	gh run watch $$ID; \
	echo; \
	gh run view $$ID --json headBranch,headSha,event,conclusion,jobs -q \
		'"\(.headBranch) @ \(.headSha[0:7]) (\(.event) run) — \(.conclusion)\n" + ([.jobs[] | "  \(.name): \(.conclusion)"] | join("\n"))'; \
	BRANCH=$$(gh run view $$ID --json headBranch -q '.headBranch'); \
	EVENT=$$(gh run view $$ID --json event -q '.event'); \
	CONC=$$(gh run view $$ID --json conclusion -q '.conclusion'); \
	if [ "$$EVENT" = "push" ] && [ "$$CONC" = "success" ] && [ "$$BRANCH" = "main" ]; then \
		echo "→ deployed PROD: $(PROD_URL)"; \
	elif [ "$$EVENT" = "push" ] && [ "$$CONC" = "success" ] && [ "$$BRANCH" = "dev" ]; then \
		echo "→ deployed DEV:  $(DEV_URL)"; \
	else \
		echo "→ nothing deployed (PR/test-only run, or the deploy didn't succeed)"; \
	fi; \
	echo; \
	$(MAKE) -s versions

open-prod: ## Open the prod site
	open $(PROD_URL)

open-dev: ## Open the dev site
	open $(DEV_URL)
