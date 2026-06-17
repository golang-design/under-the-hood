// Copyright 2020 Changkun Ou. All rights reserved.
// Use of this source code is governed by a MIT
// license that can be found in the LICENSE file.

package main

import (
	"bytes"
	"fmt"
	"io/ioutil"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

const (
	srcAssets = "../book/assets/"
	dstAssets = "content/assets/"
)

// Per-language settings. The doc pipeline runs once per language; these vars
// are reassigned for each pass (see main). zh-cn is the default language and
// lives at the site root with a literal /zh-cn/ path segment; en is a sibling
// subtree served at /en/. Keeping en as a literal subtree (not a Hugo language)
// preserves every existing /zh-cn/ URL untouched.
var (
	srcDoc       = "../book/zh-cn/"
	dstDoc       = "content/zh-cn/"
	srcREADME    = "../README.md"
	dstREADME    = "content/_index.md"
	readmeURL    = "zh-cn/preface/"        // where the "read online" link should point
	readmeBookTo = "./"                    // what the cover's "book/" prefix becomes
	cascadeType  = ""                      // when set, the home injects a cascade type
	urlPrefix    = "/under-the-hood/zh-cn" // navigation/hierarchy URL prefix for this language
)

type language struct {
	srcDoc, dstDoc, srcREADME, dstREADME string
	readmeURL, readmeBookTo, cascadeType string
	urlPrefix                            string
}

// zh-cn is the default Hugo language: it lives under content/ with a literal
// /zh-cn/ path segment and its home at the site root, so every existing URL is
// untouched. en is a second Hugo language with its own non-nested contentDir
// (content-en); Hugo serves it under /en/ and scopes the menu, table of
// contents, and language switcher to it automatically. en pages cascade
// type=zh-cn so they reuse the existing layouts/zh-cn templates.
var languages = []language{
	{
		srcDoc: "../book/zh-cn/", dstDoc: "content/zh-cn/",
		srcREADME: "../README.md", dstREADME: "content/_index.md",
		readmeURL: "zh-cn/preface/", readmeBookTo: "./", cascadeType: "",
		urlPrefix: "/under-the-hood/zh-cn",
	},
	{
		srcDoc: "../book/en-us/", dstDoc: "content-en/",
		srcREADME: "../README.en-us.md", dstREADME: "content-en/_index.md",
		readmeURL: "en/preface/", readmeBookTo: "../", cascadeType: "zh-cn",
		urlPrefix: "/under-the-hood/en",
	},
}

type section struct {
	weight int
	title  string
	url    string
	path   string
}

type bookHierarchy []section

func (h bookHierarchy) Len() int           { return len(h) }
func (h bookHierarchy) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h bookHierarchy) Less(i, j int) bool { return h[i].weight < h[j].weight }

var (
	ignores = [...]string{
		`.md`,
		`
## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).`,
	}
	hierarchy = bookHierarchy{}
)

func walkDocs(path string, info os.FileInfo, err error) error {
	// rules:
	//   - skip dirs
	if info.IsDir() {
		fmt.Printf("walkDocs: skip dir %v\n", path)
		return nil
	}
	fmt.Printf("walkDocs: handling %v\n", path)

	data, err := ioutil.ReadFile(path)
	if err != nil {
		panic(fmt.Errorf("walkDocs: cannot read: %v", err))
	}

	dst := dstDoc + strings.TrimPrefix(path, srcDoc)
	// rules:
	//   - replace readme.md to _index.md
	// rules:
	//   - ](./xxx/yyy/zzz.md) => ](.././xxx/yyy/zzz.md) if not in readme.md
	if strings.Contains(dst, "readme.md") {
		dst = strings.TrimSuffix(dst, "readme.md") + "_index.md"
	} else {
		println("file: ", dst)
		re := regexp.MustCompile("(?m)\\]\\(\\..*?\\.md\\)")
		data = []byte(re.ReplaceAllStringFunc(string(data), func(m string) string {
			ret := m[:2] + "../" + m[2:]
			println(ret)
			return ret
		}))
	}

	// create directory first
	if _, err := os.Stat(filepath.Dir(dst)); os.IsNotExist(err) {
		err := os.MkdirAll(filepath.Dir(dst), os.ModePerm)
		if err != nil {
			panic(fmt.Errorf("walkDocs: failed to create folders: %v", err))
		}
	}

	// rules:
	//   - ignore license
	//   - ignore content jumpping
	//   - ignore all .md
	for _, ignore := range ignores {
		data = bytes.Replace(data, []byte(ignore), []byte(""), -1)
	}
	// rules:
	//   - replace ../assets to assets
	data = bytes.Replace(data, []byte("../assets"), []byte("../../assets"), -1)

	// rules:
	//   - process all links in reference document.
	if strings.Contains(dst, "ref.md") {
		// find url
		re := regexp.MustCompile("(http|ftp|https)://([\\w_-]+(?:(?:\\.[\\w_-]+)+))([\\w.,@?^=%&:/~+#-]*[\\w@?^=%&/~+#-])?")
		data = []byte(re.ReplaceAllStringFunc(string(data), func(m string) string {
			ret := fmt.Sprintf(`<a href="%s">%s</a>`, m, m)
			return ret
		}))
	}

	err = ioutil.WriteFile(dst, data, os.ModePerm)
	if err != nil {
		panic(fmt.Errorf("walkDocs: cannot write: %v", err))
	}
	return nil
}

func walkAssets(path string, info os.FileInfo, err error) error {
	// rules:
	//   - skip dirs and raw files
	if info.IsDir() || strings.Contains(path, "raw") {
		fmt.Printf("walkAssets: skip dir %v\n", path)
		return nil
	}
	data, err := ioutil.ReadFile(path)
	if err != nil {
		panic(fmt.Errorf("walkAssets: cannot read: %v", err))
	}

	dst := dstAssets + strings.TrimPrefix(path, srcAssets)

	// rules:
	//   - copy .png, .jpeg, .jpg only
	if !(strings.Contains(dst, ".png") || strings.Contains(dst, ".jpeg") || strings.Contains(dst, ".jpg")) {
		return nil
	}

	fmt.Printf("walkAssets: writing %v\n", dst)
	err = ioutil.WriteFile(dst, data, os.ModePerm)
	if err != nil {
		panic(fmt.Errorf("walkAssets: cannot write: %v", err))
	}
	return nil
}

func handleREADME() {
	head := "---\ntype: zh-cn\n"
	if cascadeType != "" {
		head += "cascade:\n  type: " + cascadeType + "\n"
	}
	head += "---\n"
	data, err := ioutil.ReadFile(srcREADME)
	if err != nil {
		panic(fmt.Errorf("handleREADME: cannot read: %v", err))
	}

	data = append([]byte(head), data...)

	// HACKs
	base := "https://golang.design/under-the-hood/"
	data = bytes.Replace(data, []byte(base), []byte(base+readmeURL), -1)
	data = bytes.Replace(data, []byte(base+readmeURL+"assets/wechat.jpg"), []byte(base+"assets/wechat.jpg"), -1)
	data = bytes.Replace(data, []byte(base+readmeURL+"assets/alipay.jpg"), []byte(base+"assets/alipay.jpg"), -1)

	data = bytes.Replace(data, []byte("book/"), []byte(readmeBookTo), 2)
	data = bytes.Replace(data, []byte("./CONTRIBUTING.md"), []byte("https://github.com/golang-design/under-the-hood/blob/master/CONTRIBUTING.md"), -1)

	fmt.Printf("handleREADME: writing %v\n", dstREADME)
	err = ioutil.WriteFile(dstREADME, data, os.ModePerm)
	if err != nil {
		panic(fmt.Errorf("walkAssets: cannot write: %v", err))
	}
}

func walkDocsForHierarchy(path string, info os.FileInfo, err error) error {
	// rules:
	//   - skip dirs
	if info.IsDir() || strings.Contains(path, "DS_Store") {
		fmt.Printf("walkDocsForHierarchy: skip dir %v\n", path)
		return nil
	}

	data, err := ioutil.ReadFile(path)
	if err != nil {
		panic(fmt.Errorf("walkDocsForHierarchy: cannot read: %v", err))
	}

	// !!!HACK:
	// the following parsing is hacking the YAML meta
	// It is very ugly but works so far. Refactoring at some point
	// maybe never :)

	doc := string(data)[12:] // read weight
	endIdx := 0
	for _, ch := range doc {
		if rune(ch) == '\n' {
			break
		}
		endIdx++
	}
	rawWeight := doc[:endIdx]
	doc = doc[endIdx+9:] // read title
	endIdx = 0
	for i := 0; i < len(doc); i++ {
		if doc[i] == '\n' {
			break
		}
		endIdx++
	}

	weight, err := strconv.Atoi(rawWeight)
	if err != nil {
		panic(fmt.Errorf("walkDocsForHierarchy: expect numbers for weight: %v", err))
	}
	title := doc[:endIdx-1]
	url := urlPrefix + "/" + strings.TrimPrefix(path, dstDoc)
	url = strings.Replace(url, ".md", "", -1)
	url = strings.Replace(url, "_index", "", -1)
	hierarchy = append(hierarchy, section{
		weight: weight,
		url:    strings.ToLower(url),
		title:  title,
		path:   path,
	})
	return nil
}

func walkDocsForNavigation(path string, info os.FileInfo, err error) error {
	// rules:
	//   - skip dirs
	if info.IsDir() || strings.Contains(path, "DS_Store") {
		fmt.Printf("walkDocsForNavigation: skip dir %v\n", path)
		return nil
	}

	data, err := ioutil.ReadFile(path)
	if err != nil {
		panic(fmt.Errorf("walkDocsForNavigation: cannot read: %v", err))
	}

	// generate navigation metadata
	// - prevSec: ""
	// - prevSecTitle: ""
	// - nextSec: ""
	// - nextSecTitle: ""
	meta := ""
	for idx, h := range hierarchy {
		if h.path == path {
			prev := idx - 1
			next := idx + 1
			if prev > 0 {
				meta += fmt.Sprintf("prevSec: \"%s\"\nprevSecTitle: \"%s\"\n", hierarchy[prev].url, hierarchy[prev].title)
			}
			if next < len(hierarchy) {
				meta += fmt.Sprintf("nextSec: \"%s\"\nnextSecTitle: \"%s\"\n", hierarchy[next].url, hierarchy[next].title)
			}
			break
		}
	}
	// Pair this page with its sibling in the other language so the language
	// switcher links page-to-page. The key is the language-independent path
	// (e.g. "part3concurrency/ch09sched/steal"), identical across zh-cn and en.
	key := strings.TrimPrefix(path, dstDoc)
	key = strings.TrimSuffix(key, ".md")
	key = strings.TrimSuffix(key, "_index")
	key = strings.Trim(key, "/")
	meta += fmt.Sprintf("translationKey: \"%s\"\n", key)

	dataWithNavi := make([]byte, 4)
	copy(dataWithNavi, data[:4])
	dataWithNavi = append(dataWithNavi, []byte(meta)...)
	dataWithNavi = append(dataWithNavi, data[4:]...)
	err = ioutil.WriteFile(path, dataWithNavi, os.ModePerm)
	if err != nil {
		panic(fmt.Errorf("walkDocs: cannot write: %v", err))
	}
	return nil
}

func main() {
	// Shared assets directory.
	if err := os.MkdirAll(dstAssets, os.ModePerm); err != nil {
		panic(fmt.Errorf("make: failed to create folders: %v", err))
	}

	// Run the doc pipeline once per language. The package-level vars that the
	// walk callbacks read (srcDoc, dstDoc, readmeURL, ...) are reassigned for
	// each pass, and the hierarchy is rebuilt from scratch so navigation links
	// stay within one language.
	for _, l := range languages {
		srcDoc, dstDoc = l.srcDoc, l.dstDoc
		srcREADME, dstREADME = l.srcREADME, l.dstREADME
		readmeURL, readmeBookTo, cascadeType = l.readmeURL, l.readmeBookTo, l.cascadeType
		urlPrefix = l.urlPrefix
		hierarchy = bookHierarchy{}

		// 1. create the language's content directory
		if err := os.MkdirAll(dstDoc, os.ModePerm); err != nil {
			panic(fmt.Errorf("make: failed to create folders: %v", err))
		}

		// 2. walk all docs, then build hierarchy and navigation
		filepath.Walk(srcDoc, walkDocs)
		filepath.Walk(dstDoc, walkDocsForHierarchy)
		sort.Sort(hierarchy)
		for _, h := range hierarchy {
			println("weight: ", h.weight, " title: ", h.title, " url: ", h.url)
		}
		filepath.Walk(dstDoc, walkDocsForNavigation)

		// 3. handle the language's README home page
		handleREADME()
	}

	// 4. walk all assets once (shared across languages)
	filepath.Walk(srcAssets, walkAssets)
}
