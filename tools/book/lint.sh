#!/bin/sh
# Mechanical checks (punctuation and rendering pitfalls) from book/CONVENTIONS.md.
#
#   tools/book/lint.sh book/zh-cn/part1overview          # a directory
#   tools/book/lint.sh book/zh-cn/part1overview/ch03life/main.md
#
# Prints every hit as file:line: text and exits 1 if anything was found. It
# only catches mechanical slips; whether the text reads well is decided by
# reading it.

set -u
[ $# -gt 0 ] || set -- book/zh-cn book/en-us
status=0

check() { # label, extended regex, paths...
	label=$1; re=$2; shift 2
	out=$(grep -rnE --include='*.md' "$re" "$@" 2>/dev/null)
	if [ -n "$out" ]; then
		printf '\n== %s\n%s\n' "$label" "$out"
		status=1
	fi
}

zh=""; for p in "$@"; do case $p in *en-us*) ;; *) zh="$zh $p" ;; esac; done

# Em dashes are allowed in the reading list, where they are part of paper titles.
out=$(find "$@" -name '*.md' -exec awk 'FNR == 1 { refs = 0 }
	/^## 延伸阅读|^## Further Reading/ { refs = 1 }
	/^## / && !/^## 延伸阅读|^## Further Reading/ { refs = 0 }
	!refs && /—/ { print FILENAME ":" FNR ": " $0 }' {} +)
if [ -n "$out" ]; then
	printf '\n== %s\n%s\n' "em dash (use comma, colon, parentheses or a new sentence)" "$out"
	status=1
fi
check "single tilde in a numeric range (write 2 至 3 / 2 to 3)" '[0-9]~[0-9]' "$@"
if [ -n "$zh" ]; then
	# shellcheck disable=SC2086
	check "ASCII comma next to Chinese text (use ，)" '[一-龥」）],|,[一-龥「（]' $zh
	# shellcheck disable=SC2086
	check "old heading (use 延伸阅读)" '^## 延伸阅读的文献' $zh
	# Reading-list entries quote titles verbatim, so they are exempt.
	# shellcheck disable=SC2086
	out=$(grep -rnE --include='*.md' '[^「]你[们的]?[^好]' $zh 2>/dev/null | grep -vE '^[^:]+:[0-9]+:- <a id="ref-')
	if [ -n "$out" ]; then
		printf '\n== %s\n%s\n' "second person in body prose (use 读者 / 我们)" "$out"
		status=1
	fi
fi

[ $status -eq 0 ] && echo "lint: ok"
exit $status
