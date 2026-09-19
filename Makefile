# Root entrypoint so CI configs, agent harnesses and new contributors can
# discover the validation gate without reading CONTRIBUTING.
# The gate itself lives in tests/validate-schemas.sh — this file only delegates.

.PHONY: test validate

test: validate

validate:
	bash tests/validate-schemas.sh
