package main

import (
	"bytes"
	"fmt"
	"io/ioutil"
	"os"
	"path/filepath"
	"strings"
)

const (
	srcDoc    = "../book/zh-cn/"
	srcAssets = "../book/assets/"
	srcREADME = "../README.md"
	dstDoc    = "content/zh-cn/"
	dstAssets = "content/assets/"
	dstREADME = "content/_index.md"
)

var ignores = [...]string{
	`
[TOC]
`,
	`.md`,
	`
## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)`,
}

func walkDocs(path string, info os.FileInfo, err error) error {
	// rules:
	//   - skip dirs
	//   - skip TOC.md
	if info.IsDir() || strings.Contains(path, "TOC.md") {
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
	if strings.Contains(dst, "readme.md") {
		dst = strings.TrimSuffix(dst, "readme.md") + "_index.md"
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
	//   - ignore [TOC]
	//   - ignore all .md
	for _, ignore := range ignores {
		data = bytes.Replace(data, []byte(ignore), []byte(""), -1)
	}
	// rules:
	//   - replace ../assets to assets
	data = bytes.Replace(data, []byte("../assets"), []byte("../../assets"), -1)

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
	//   - copy .png and .jpeg only
	if !(strings.Contains(dst, ".png") || strings.Contains(dst, ".jpeg")) {
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
	head := `---
type: zh-cn
---
`
	data, err := ioutil.ReadFile(srcREADME)
	if err != nil {
		panic(fmt.Errorf("handleREADME: cannot read: %v", err))
	}

	data = append([]byte(head), data...)

	data = bytes.Replace(data, []byte("https://changkun.de/golang/"), []byte("https://changkun.de/golang/zh-cn/preface/"), -1)
	data = bytes.Replace(data, []byte("book/"), []byte("./"), 2)
	data = bytes.Replace(data, []byte("./CONTRIBUTING.md"), []byte("https://github.com/changkun/go-under-the-hood/blob/master/CONTRIBUTING.md"), -1)

	fmt.Printf("handleREADME: writing %v\n", dstREADME)
	err = ioutil.WriteFile(dstREADME, data, os.ModePerm)
	if err != nil {
		panic(fmt.Errorf("walkAssets: cannot write: %v", err))
	}
}

func main() {
	dirs := [...]string{
		dstDoc,
		dstAssets,
	}
	// 1. create all directory
	for _, d := range dirs {
		err := os.MkdirAll(d, os.ModePerm)
		if err != nil {
			panic(fmt.Errorf("make: failed to create folders: %v", err))
		}
	}

	// 2. walk all files
	filepath.Walk(srcDoc, walkDocs)

	// 3. walk all assets
	filepath.Walk(srcAssets, walkAssets)

	// 4. handle README.md
	handleREADME()
}
