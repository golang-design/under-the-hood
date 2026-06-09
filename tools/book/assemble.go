// Command assemble collects the book's per-section Markdown files, orders them
// by their Hugo `weight` front matter, strips the front matter and the repeated
// per-section license footer, and concatenates everything into a single
// Markdown document suitable for handing to mermaid-cli + pandoc.
//
// It is the first stage of the PDF/EPUB build pipeline (see Makefile).
//
//	go run assemble.go -src ../../book/zh-cn -out build/book.md
package main

import (
	"bufio"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

type section struct {
	weight int
	title  string
	body   string
	path   string
}

var (
	licenseRe = regexp.MustCompile(`(?ms)\n#+\s*许可\s*\n.*?Licensed under.*?$`)
	hiddenRe  = regexp.MustCompile(`(?m)^bookHidden:\s*true\s*$`)
)

func main() {
	src := flag.String("src", "../../book/zh-cn", "source directory of the zh-cn book")
	out := flag.String("out", "build/book.md", "combined markdown output path")
	flag.Parse()

	var secs []section
	err := filepath.Walk(*src, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() || filepath.Ext(p) != ".md" {
			return nil
		}
		raw, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		fm, body, ok := splitFrontMatter(string(raw))
		if !ok {
			return nil // not a content page
		}
		if hiddenRe.MatchString(fm) { // skip bookHidden pages (e.g. donate)
			return nil
		}
		w, ok := frontInt(fm, "weight")
		if !ok {
			return nil // pages without a weight are not part of the linear book
		}
		body = licenseRe.ReplaceAllString(body, "") // drop the repeated footer
		secs = append(secs, section{
			weight: w,
			title:  frontStr(fm, "title"),
			body:   strings.TrimSpace(body),
			path:   p,
		})
		return nil
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "assemble:", err)
		os.Exit(1)
	}

	sort.SliceStable(secs, func(i, j int) bool { return secs[i].weight < secs[j].weight })

	if err := os.MkdirAll(filepath.Dir(*out), 0o755); err != nil {
		fmt.Fprintln(os.Stderr, "assemble:", err)
		os.Exit(1)
	}
	f, err := os.Create(*out)
	if err != nil {
		fmt.Fprintln(os.Stderr, "assemble:", err)
		os.Exit(1)
	}
	defer f.Close()
	bw := bufio.NewWriter(f)
	defer bw.Flush()

	for i, s := range secs {
		if i > 0 {
			fmt.Fprint(bw, "\n\n")
		}
		fmt.Fprint(bw, s.body, "\n")
	}

	fmt.Fprintf(os.Stderr, "assemble: combined %d sections -> %s\n", len(secs), *out)
}

// splitFrontMatter separates a leading `--- ... ---` YAML block from the body.
func splitFrontMatter(s string) (front, body string, ok bool) {
	s = strings.TrimLeft(s, "\ufeff \n")
	if !strings.HasPrefix(s, "---") {
		return "", s, false
	}
	rest := s[len("---"):]
	idx := strings.Index(rest, "\n---")
	if idx < 0 {
		return "", s, false
	}
	front = rest[:idx]
	body = rest[idx+len("\n---"):]
	return front, body, true
}

func frontStr(front, key string) string {
	for _, line := range strings.Split(front, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, key+":") {
			v := strings.TrimSpace(strings.TrimPrefix(line, key+":"))
			return strings.Trim(v, `"`)
		}
	}
	return ""
}

func frontInt(front, key string) (int, bool) {
	v := frontStr(front, key)
	if v == "" {
		return 0, false
	}
	n, err := strconv.Atoi(v)
	return n, err == nil
}
